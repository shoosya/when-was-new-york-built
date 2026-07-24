// Landing page: a map of NYC's five boroughs. Click one to open its detail page.

// Start centered on the city; we'll fit to the borough shapes once they load.
const map = L.map("map").setView([40.7, -73.94], 10);

// A muted, light basemap keeps the colored data readable. CARTO's tiles need
// no API key. (The borough page uses the same base.)
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// How the borough shapes look normally vs. when hovered.
const baseStyle = {
  color: "#b3123c",
  weight: 2,
  fillColor: "#f6531f",
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

        // Name label follows the cursor over the shape.
        shapeLayer.bindTooltip(name, { sticky: true, direction: "top" });

        // Highlight on hover, then go to the detail page on click.
        shapeLayer.on("mouseover", () => shapeLayer.setStyle(hoverStyle));
        shapeLayer.on("mouseout", () => shapeLayer.setStyle(baseStyle));
        shapeLayer.on("click", () => {
          window.location.href = `borough.html?borough=${slug}`;
        });
      },
    }).addTo(map);

    // Frame all five boroughs neatly.
    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  })
  .catch((err) => {
    console.error(err);
    alert("Could not load borough boundaries.");
  });
