// deno-lint-ignore-file
// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // student-controlled page style

// Fix missing marker images
import "./_leafletWorkaround.ts"; // fixes for missing Leaflet images

// Import our luck function
import luck from "./_luck.ts";

// ========= CONFIGURATION & CONSTANTS ============

const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const TOKEN_SPAWN_PROBABILITY = 0.1;
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
); // Our classroom location
const WIN_VALUE_TOKEN = 256; //256
const INTERACTION_LIMIT = 3; //test this out 4 might work better

const STYLE_DEFAULT = { color: "#3388ff", weight: 3, fillOpacity: 0.2 }; // Standard Blue
const STYLE_NEARBY = { color: "#ffd700", weight: 5, fillOpacity: 0.5 }; // yellow when nearby

// ========== UI Elements ===================

const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";
document.body.append(controlPanelDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

// ======== Game State ==============

let playerInventory: number | null = null;
let playerPosition = CLASSROOM_LATLNG;

//only stores cells that have changed
const savedcells = new Map<string, number | null>();
//keeps track of leaflet layers
const cellRectangles = new Map<string, leaflet.Rectangle>();

// ========== Save State (Persistence) System ========================

function saveGameState() {
  //save inventory
  localStorage.setItem("playerInventory", JSON.stringify(playerInventory));

  // Save lat/lng position
  localStorage.setItem(
    "playerPosition",
    JSON.stringify({
      lat: playerPosition.lat,
      lng: playerPosition.lng,
    }),
  );

  // Save the modified cells
  localStorage.setItem(
    "momentos",
    JSON.stringify(Array.from(savedcells.entries())),
  );
}

function loadGameState() {
  //load inventory
  const invData = localStorage.getItem("playerInventory");
  if (invData && invData !== "null") {
    playerInventory = Number(JSON.parse(invData));
  } else {
    playerInventory = null;
  }

  // Load Position
  const posData = localStorage.getItem("playerPosition");
  if (posData) {
    const { lat, lng } = JSON.parse(posData);
    playerPosition = leaflet.latLng(lat, lng);
  }

  // Load Mementos
  const momentosData = localStorage.getItem("momentos");
  if (momentosData) {
    const entries = JSON.parse(momentosData);
    entries.forEach(([key, value]: [string, any]) => {
      // Ensure values are correct types (null or number)
      if (value === null) {
        savedcells.set(key, null);
      } else {
        savedcells.set(key, Number(value));
      }
    });
  }
}

function resetGame() {
  if (!confirm("Are you sure you want to wipe your save and reset?")) return;
  localStorage.clear();
  playerInventory = null;
  savedcells.clear();
  for (const rect of cellRectangles.values()) {
    rect.remove();
  }
  cellRectangles.clear();
  updateStatusPanel();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      // Success: Teleport to IRL
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      console.log("Resetting game to IRL location:", lat, lng);
      updatePlayerPosition(lat, lng);
    },
    (error) => {
      // Teleport to Classroom if GPS fails
      console.warn("Reset fallback: GPS failed", error);
      updatePlayerPosition(CLASSROOM_LATLNG.lat, CLASSROOM_LATLNG.lng);
    },
  );
}

// =============== Facade Pattern =================

class LocationManager {
  private watchId: number | null = null;

  // Toggle between GPS and Manual
  toggleGeolocation(enable: boolean) {
    if (enable) {
      if (this.watchId !== null) return; // Already enabled

      console.log("Enabling Geolocation...");
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          updatePlayerPosition(
            position.coords.latitude,
            position.coords.longitude,
          );
        },
        (error) => console.error("Geolocation Error:", error),
        {
          enableHighAccuracy: true,
          maximumAge: 0,
        },
      );
    } else {
      if (this.watchId === null) return; // Already disabled

      console.log("Disabling Geolocation...");
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

const locationManager = new LocationManager();

// ================ Movement Logic =================

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(mapDiv, {
  center: CLASSROOM_LATLNG,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

const playerMarker = leaflet.marker(playerPosition);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

function updatePlayerPosition(lat: number, lng: number) {
  playerPosition = leaflet.latLng(lat, lng);
  playerMarker.setLatLng(playerPosition);
  map.panTo(playerPosition);

  updateGrid();
  saveGameState();
}

function movePlayer(latOffset: number, lngOffset: number) {
  const newLat = playerPosition.lat + latOffset;
  const newLng = playerPosition.lng + lngOffset;
  updatePlayerPosition(newLat, newLng);
}

// =========== Grid & Cell Logic ========================

function cellKey(i: number, j: number): string {
  return `${i},${j}`;
}

function latLngToCell(lat: number, lng: number): { i: number; j: number } {
  const i = Math.floor((lat - CLASSROOM_LATLNG.lat) / TILE_DEGREES);
  const j = Math.floor((lng - CLASSROOM_LATLNG.lng) / TILE_DEGREES);
  return { i, j };
}
function cellToLatLngBounds(i: number, j: number): leaflet.LatLngBounds {
  // Calculate the latitude and longitude of the cell's bottom-left corner
  const lat1 = CLASSROOM_LATLNG.lat + i * TILE_DEGREES;
  const lng1 = CLASSROOM_LATLNG.lng + j * TILE_DEGREES;

  // Calculate the latitude and longitude of the cell's top-right corner
  const lat2 = CLASSROOM_LATLNG.lat + (i + 1) * TILE_DEGREES;
  const lng2 = CLASSROOM_LATLNG.lng + (j + 1) * TILE_DEGREES;

  return leaflet.latLngBounds([
    [lat1, lng1],
    [lat2, lng2],
  ]);
}

function isNearby(i: number, j: number): boolean {
  // Get player's current cell position
  const playerCell = latLngToCell(playerPosition.lat, playerPosition.lng);

  // Check distance from player's cell to target cell
  const di = Math.abs(i - playerCell.i);
  const dj = Math.abs(j - playerCell.j);

  return di <= INTERACTION_LIMIT && dj <= INTERACTION_LIMIT;
}

function getCanonicalCell(i: number, j: number): number | null {
  const key = [i, j, "hasToken"].toString();
  // Check luck to see if a token exists by default
  if (luck(key) < TOKEN_SPAWN_PROBABILITY) {
    const valueKey = [i, j, "tokenValue"].toString();
    const possibleValues = [1, 2, 4, 8];
    const randomIndex = Math.floor(luck(valueKey) * possibleValues.length);
    return possibleValues[randomIndex];
  }
  return null;
}

function getCellStatus(i: number, j: number): number | null {
  const key = cellKey(i, j);
  // Check if we have a saved state (Memento)
  if (savedcells.has(key)) {
    return savedcells.get(key)!;
  }
  return getCanonicalCell(i, j); // If no saved state, return the default generation
}

function saveCellStatus(i: number, j: number, value: number | null) {
  const key = cellKey(i, j);
  savedcells.set(key, value);
}

// ============= Visual Logic =====================

function updateStatusPanel() {
  if (playerInventory === null) {
    statusPanelDiv.innerHTML = "Inventory: Empty";
  } else {
    statusPanelDiv.innerHTML = `Inventory: Token with value ${playerInventory}`;
  }
}

updateStatusPanel(); // initalize the Status pannel

function getVisibleCells(): {
  iMin: number;
  iMax: number;
  jMin: number;
  jMax: number;
} {
  const bounds = map.getBounds(); // Get visible lat/lng area

  // Convert corners to cell coordinates
  const northWest = latLngToCell(bounds.getNorth(), bounds.getWest());
  const southEast = latLngToCell(bounds.getSouth(), bounds.getEast());

  //TODO: change naming convention
  return {
    iMin: southEast.i, // South is smaller i (lower latitude)
    iMax: northWest.i, // North is larger i (higher latitude)
    jMin: northWest.j, // West is smaller j (lower longitude)
    jMax: southEast.j, // East is larger j (higher longitude)
  };
}

function updateGrid() {
  const visible = getVisibleCells();

  // We iterate over all existing cells to see if they are still within bounds
  for (const key of cellRectangles.keys()) {
    const [i, j] = key.split(",").map(Number);
    if (
      i < visible.iMin ||
      i > visible.iMax ||
      j < visible.jMin ||
      j > visible.jMax
    ) {
      //if its off screen remove it
      removeCell(i, j); // Removes the visual rectangle
    }
  }

  // Create cells that are now visible but haven't been generated yet
  for (let i = visible.iMin; i <= visible.iMax; i++) {
    for (let j = visible.jMin; j <= visible.jMax; j++) {
      const key = cellKey(i, j);

      // Only create if we don't already know about this cell
      if (!cellRectangles.has(key)) {
        const value = getCellStatus(i, j); //checks the memento then flyweight

        // We only draw if there is something to show
        if (value !== null) {
          drawCell(i, j, value);
        }
      }
      updateCellColor(i, j);
    }
  }
}

function drawCell(i: number, j: number, tokenValue: number) {
  // Calculate the lat/lng bounds for this cell
  const bounds = cellToLatLngBounds(i, j);
  // Create a rectangle for this cell
  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Bind a tooltip that shows the token value
  rect.bindTooltip(`${tokenValue}`, {
    permanent: true,
    direction: "center",
    className: "token-value-label",
  });

  rect.on("click", (e) => {
    leaflet.DomEvent.stopPropagation(e);
    handleCellClick(i, j);
  });

  cellRectangles.set(cellKey(i, j), rect);
}

function removeCell(i: number, j: number) {
  const key = cellKey(i, j);
  const rect = cellRectangles.get(key);
  if (rect) {
    rect.unbindTooltip();
    rect.remove();
    cellRectangles.delete(key);
  }
}

function updateCell(i: number, j: number, newValue: number | null) {
  // Remove old representation
  removeCell(i, j);
  if (newValue !== null) {
    drawCell(i, j, newValue);
    updateCellColor(i, j);
  }
}
function updateCellColor(i: number, j: number) {
  const key = cellKey(i, j);
  const rect = cellRectangles.get(key);
  if (rect) {
    if (isNearby(i, j)) {
      rect.setStyle(STYLE_NEARBY); // Yellow
    } else {
      rect.setStyle(STYLE_DEFAULT); // Blue
    }
  }
}
// =============== Handlers =====================

function handleCellClick(i: number, j: number) {
  // Check if cell is nearby

  if (!isNearby(i, j)) {
    statusPanelDiv.innerHTML = "That cell is too far!";
    return;
  }

  const cellToken = getCellStatus(i, j);
  //const cellToken = getCellToken(i, j);

  // Case 1: Cell has no token
  if (cellToken === null) {
    if (playerInventory !== null) {
      const valueToDrop = playerInventory;
      statusPanelDiv.innerHTML =
        `bug check: player inventory is ${playerInventory}`;

      //update state
      saveCellStatus(i, j, valueToDrop);
      playerInventory = null;

      //update visuals to add the new cell
      updateStatusPanel();
      updateCell(i, j, valueToDrop);
      saveGameState();
      statusPanelDiv.innerHTML = `Dropped token with value ${valueToDrop}`;
    } else {
      statusPanelDiv.innerHTML = "This cell is empty";
    }
    return;
  }

  // Case 2: Player inventory is empty - collect the token
  if (playerInventory === null) {
    playerInventory = cellToken;

    saveCellStatus(i, j, null);

    //update ui
    updateStatusPanel();
    updateCell(i, j, null);
    saveGameState();
    statusPanelDiv.innerHTML = `collected token. Value is ${cellToken}`;
    return;
  }

  // Case 3: Player has a token - try to craft
  if (playerInventory === cellToken) {
    const newValue = playerInventory * 2;

    //update cell state
    saveCellStatus(i, j, newValue);
    playerInventory = null; //clear plyaer inventory

    updateStatusPanel();
    updateCell(i, j, newValue);
    saveGameState();

    statusPanelDiv.innerHTML = `Crafted token with value ${newValue}!`;

    // Check win condition
    if (newValue >= WIN_VALUE_TOKEN) {
      statusPanelDiv.innerHTML = `YOU WIN!you got to: ${newValue}!`;
    }
  } else {
    // Tokens don't match
    statusPanelDiv.innerHTML =
      `Cannot craft: your token doesn't match cell token`;
  }
}

// ============== Initilization ====================

const moveNorthBtn = document.createElement("button");
moveNorthBtn.innerHTML = "North";
controlPanelDiv.append(moveNorthBtn);

const moveSouthBtn = document.createElement("button");
moveSouthBtn.innerHTML = "South";
controlPanelDiv.append(moveSouthBtn);

const moveWestBtn = document.createElement("button");
moveWestBtn.innerHTML = "West";
controlPanelDiv.append(moveWestBtn);

const moveEastBtn = document.createElement("button");
moveEastBtn.innerHTML = "East";
controlPanelDiv.append(moveEastBtn);

const sensorBtn = document.createElement("button");
sensorBtn.innerHTML = "GPS: OFF";
controlPanelDiv.append(sensorBtn);

const resetBtn = document.createElement("button");
resetBtn.innerHTML = "RESET";
controlPanelDiv.append(resetBtn);

//movement handlers
moveNorthBtn.addEventListener("click", () => {
  movePlayer(TILE_DEGREES, 0);
});

moveSouthBtn.addEventListener("click", () => {
  movePlayer(-1 * TILE_DEGREES, 0);
});

moveWestBtn.addEventListener("click", () => {
  movePlayer(0, -1 * TILE_DEGREES);
});

moveEastBtn.addEventListener("click", () => {
  movePlayer(0, 1 * TILE_DEGREES);
});

resetBtn.addEventListener("click", resetGame);

// Toggle GPS Listener
let isGpsActive = false;
sensorBtn.addEventListener("click", () => {
  isGpsActive = !isGpsActive;
  if (isGpsActive) {
    sensorBtn.innerHTML = "GPS: ON";
    sensorBtn.style.backgroundColor = "#ccffcc";

    moveNorthBtn.disabled = true;
    moveSouthBtn.disabled = true;
    moveWestBtn.disabled = true;
    moveEastBtn.disabled = true;

    locationManager.toggleGeolocation(true);
  } else {
    sensorBtn.innerHTML = "GPS: OFF";
    sensorBtn.style.backgroundColor = "";

    moveNorthBtn.disabled = false;
    moveSouthBtn.disabled = false;
    moveWestBtn.disabled = false;
    moveEastBtn.disabled = false;

    locationManager.toggleGeolocation(false);
  }
});

// Handle clicks on empty spots
map.on("click", (e) => {
  // Convert the mouse click lat/lng to a cell grid index
  const { i, j } = latLngToCell(e.latlng.lat, e.latlng.lng);
  // Attempt to interact with that cell
  handleCellClick(i, j);
});

map.on("moveend", () => {
  console.log("moveend");

  console.log(getVisibleCells());
  updateGrid();
});

loadGameState(); // Load saved data
// Move map to loaded position immediately
playerMarker.setLatLng(playerPosition);
map.panTo(playerPosition);
updateStatusPanel();
updateGrid();
console.log(`Grid initialized.`);
