import React, { useState } from "react";
import { Marker, Popup } from "react-map-gl/maplibre";

interface MapMarkerProps {
  lat: number;
  lng: number;
  imgUrl?: string;
  style?: React.CSSProperties;
  popupContent?: string;
  title?: string;
  label?: string;
  [key: string]: any;
}

const MapMarker = (props: MapMarkerProps) => {
  const { lat, lng, imgUrl, style, popupContent, title, label, ...rest } = props;
  const [showPopup, setShowPopup] = useState(false);

  return (
    <>
      <Marker
        latitude={lat}
        longitude={lng}
        style={style}
        {...rest}
        onClick={(e) => {
          e.originalEvent.stopPropagation(); // Prevent map click from closing popup
          setShowPopup(true);
        }}
      >
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={title}
            className="cursor-pointer"
            style={{
                marginTop: "-1em"
            }}
            // hidden={true}
            onClick={(e) => {
              e.stopPropagation(); // prevent map click from bubbling
              setShowPopup(true);
            }}
          />
        ) : (
          <div
            className="flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-bold text-white shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              setShowPopup(true);
            }}
          >
            {label}
          </div>
        )}
      </Marker>

      {showPopup && (
        <Popup
          latitude={lat}
          longitude={lng}
          onClose={() => setShowPopup(false)}
          anchor="bottom"
          className="p-4 rounded-lg text-gray-500"
          style={{
            // dropShadow: "0 4px 6px rgba(0, 0, 0, 0.8)",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
            backdropFilter: "blur(1px)",
          }}
        >
          <div className="p-2 bg-linear-to-br text-white from-[#34D399] to-[#6e6e6e] rounded-md drop-shadow-sm shadow">
            <div dangerouslySetInnerHTML={{ __html: popupContent || "" }} />
          </div>
        </Popup>
      )}
    </>
  );
};

export default MapMarker;
