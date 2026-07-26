// Landing page: a map of NYC's five boroughs. Click one to open its detail page.

const map = L.map("map").setView([40.7, -73.94], 10);

// Muted basemap keeps the colored data readable; CARTO needs no API key.
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

const baseStyle = {
  color: "#156eac",
  weight: 2,
  fillColor: "#f6575e",
  fillOpacity: 0.35,
};
const hoverStyle = { fillOpacity: 0.6, weight: 3 };

fetch("data/boroughs.geojson")
  .then((response) => response.json())
  .then((geojson) => {
    const layer = L.geoJSON(geojson, {
      style: baseStyle,
      onEachFeature: (feature, shapeLayer) => {
        const { name, slug } = feature.properties;
        const open = () => {
          window.location.href = `borough.html?borough=${slug}`;
        };

        // sticky: the label follows the cursor across the shape.
        shapeLayer.bindTooltip(name, { sticky: true, direction: "top" });

        shapeLayer.on("mouseover", () => shapeLayer.setStyle(hoverStyle));
        shapeLayer.on("mouseout", () => shapeLayer.setStyle(baseStyle));
        shapeLayer.on("click", open);

        // The only way into a borough page, so it must work without a mouse.
        shapeLayer.on("add", () => {
          const el = shapeLayer.getElement();
          if (!el) return;
          el.setAttribute("tabindex", "0");
          el.setAttribute("role", "link");
          el.setAttribute("aria-label", `${name} — explore its buildings`);
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open();
            }
          });
          el.addEventListener("focus", () => shapeLayer.setStyle(hoverStyle));
          el.addEventListener("blur", () => shapeLayer.setStyle(baseStyle));
        });
      },
    }).addTo(map);

    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  })
  .catch((err) => {
    console.error(err);
    alert("Could not load borough boundaries.");
  });
