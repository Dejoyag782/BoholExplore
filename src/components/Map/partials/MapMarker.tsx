import React, { useState } from "react";
import { Marker, Popup } from "react-map-gl/maplibre";

interface MapMarkerProps {
  lat: number;
  lng: number;
  imgUrl?: string;
  style?: React.CSSProperties;
  popupContent?: string;
  title?: string;
  [key: string]: any;
}

const MapMarker = (props: MapMarkerProps) => {
  const { lat, lng, imgUrl, style, popupContent, title, ...rest } = props;
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
            className="w-4 h-4 bg-red-500 rounded-full cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setShowPopup(true);
            }}
          />
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
