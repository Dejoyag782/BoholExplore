import fs from "node:fs";
import path from "node:path";

const modelPath = path.resolve("public/models/tank-v1.glb");
const source = fs.readFileSync(modelPath);
const jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString("utf8"));
const binaryHeaderOffset = 20 + jsonLength;
const binaryLength = source.readUInt32LE(binaryHeaderOffset);
const binaryOffset = binaryHeaderOffset + 8;
const binary = source.subarray(binaryOffset, binaryOffset + binaryLength);
const alreadySplit = json.nodes?.some((node) => node.name === "TurretPivot");
if (alreadySplit) {
  console.log("Tank model already contains TurretPivot; no changes made");
  process.exit(0);
}

const originalIndexAccessor = json.accessors[0];
const originalIndexView = json.bufferViews[originalIndexAccessor.bufferView];
const positionAccessor = json.accessors[1];
const positionView = json.bufferViews[positionAccessor.bufferView];
if (originalIndexAccessor.componentType !== 5125 || positionAccessor.componentType !== 5126) {
  throw new Error("Expected uint32 indices and float32 positions");
}

const readIndices = (accessorIndex) => {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  return new Uint32Array(
    binary.buffer,
    binary.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    accessor.count
  );
};

let hullIndices;
let turretIndices;
let sourceNode;
let baseBinaryLength = binary.length;

if (alreadySplit) {
  const hullPrimitive = json.meshes.find((mesh) => mesh.name === "Hull")?.primitives?.[0];
  const turretPrimitive = json.meshes.find((mesh) => mesh.name === "Turret")?.primitives?.[0];
  if (!hullPrimitive || !turretPrimitive) throw new Error("Existing turret split is incomplete");
  hullIndices = Array.from(readIndices(hullPrimitive.indices));
  turretIndices = Array.from(readIndices(turretPrimitive.indices));
  sourceNode = json.nodes.find((node) => node.name === "TankRoot");
  baseBinaryLength = Math.min(
    json.bufferViews[json.accessors[hullPrimitive.indices].bufferView].byteOffset,
    json.bufferViews[json.accessors[turretPrimitive.indices].bufferView].byteOffset
  );
} else {
  const sourcePrimitive = json.meshes?.[0]?.primitives?.[0];
  sourceNode = json.nodes?.[0];
  if (!sourcePrimitive || !sourceNode || json.nodes.length !== 1) {
    throw new Error("Expected original tank-v1.glb to contain one mesh node");
  }
  const indices = readIndices(sourcePrimitive.indices);
  const positions = new DataView(
    binary.buffer,
    binary.byteOffset + (positionView.byteOffset ?? 0),
    positionView.byteLength
  );
  const stride = positionView.byteStride ?? 12;
  hullIndices = [];
  turretIndices = [];
  // Raw coordinates from this quantized asset. Cut follows turret-ring seam.
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = [indices[index], indices[index + 1], indices[index + 2]];
    const averageY = triangle.reduce(
      (sum, vertex) => sum + positions.getFloat32(vertex * stride + 4, true),
      0
    ) / 3;
    (averageY >= 3_850 ? turretIndices : hullIndices).push(...triangle);
  }
}

if (!sourceNode || hullIndices.length === 0 || turretIndices.length === 0) {
  throw new Error("Turret split produced an invalid hierarchy");
}

const hullBuffer = Buffer.from(new Uint32Array(hullIndices).buffer);
const turretBuffer = Buffer.from(new Uint32Array(turretIndices).buffer);
const indexOffset = originalIndexView.byteOffset ?? 0;
const nextBinary = Buffer.from(binary.subarray(0, baseBinaryLength));
hullBuffer.copy(nextBinary, indexOffset);
turretBuffer.copy(nextBinary, indexOffset + hullBuffer.length);

json.bufferViews = json.bufferViews.slice(0, 6);
json.accessors = json.accessors.slice(0, 4);
json.bufferViews[originalIndexAccessor.bufferView] = {
  ...originalIndexView,
  byteOffset: indexOffset,
  byteLength: hullBuffer.length,
};
const turretViewIndex = json.bufferViews.push({
  buffer: 0,
  byteOffset: indexOffset + hullBuffer.length,
  byteLength: turretBuffer.length,
  target: 34963,
}) - 1;
json.accessors[0] = { ...originalIndexAccessor, count: hullIndices.length };
const turretAccessorIndex = json.accessors.push({
  type: "SCALAR",
  componentType: 5125,
  count: turretIndices.length,
  bufferView: turretViewIndex,
  byteOffset: 0,
}) - 1;

const sourceMaterial = json.meshes[0].primitives[0].material;
const sharedPrimitive = {
  attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
  material: sourceMaterial,
  mode: 4,
};
json.meshes = [
  { name: "Hull", primitives: [{ ...sharedPrimitive, indices: 0 }] },
  { name: "Turret", primitives: [{ ...sharedPrimitive, indices: turretAccessorIndex }] },
];
const turretPivot = [11_000, 3_850, 4_075];
json.nodes = [
  {
    name: "TankRoot",
    children: [1, 2],
    translation: sourceNode.translation,
    rotation: sourceNode.rotation,
    scale: sourceNode.scale,
  },
  { name: "Hull", mesh: 0 },
  { name: "TurretPivot", translation: turretPivot, children: [3] },
  { name: "Turret", mesh: 1, translation: turretPivot.map((value) => -value) },
];
json.scenes[json.scene ?? 0].nodes = [0];
json.buffers[0].byteLength = nextBinary.length;
json.asset.generator = "glTF-Transform v4.2.1; BoholTrips3D turret splitter";

const jsonBody = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.concat([jsonBody, Buffer.alloc((4 - (jsonBody.length % 4)) % 4, 0x20)]);
const binaryChunk = Buffer.concat([nextBinary, Buffer.alloc((4 - (nextBinary.length % 4)) % 4)]);
const output = Buffer.allocUnsafe(12 + 8 + jsonChunk.length + 8 + binaryChunk.length);
output.write("glTF", 0);
output.writeUInt32LE(2, 4);
output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(jsonChunk.length, 12);
output.writeUInt32LE(0x4e4f534a, 16);
jsonChunk.copy(output, 20);
const outputBinaryHeader = 20 + jsonChunk.length;
output.writeUInt32LE(binaryChunk.length, outputBinaryHeader);
output.writeUInt32LE(0x004e4942, outputBinaryHeader + 4);
binaryChunk.copy(output, outputBinaryHeader + 8);

fs.writeFileSync(modelPath, output);
console.log(`Split tank: ${hullIndices.length / 3} hull triangles, ${turretIndices.length / 3} turret triangles`);
