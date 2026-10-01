// Must be evaluated before any 'cesium' import: tells Cesium where its static
// Workers/Assets/Widgets live (copied there by build/cesiumAssets.js).
globalThis.CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium`;
