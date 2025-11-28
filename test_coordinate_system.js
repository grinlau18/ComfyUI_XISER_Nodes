/**
 * Test script for verifying the new coordinate system architecture
 * This simulates the coordinate transformations used in the image editor
 */

function testCoordinateSystem() {
  console.log("=== Testing XIS_ImageManager Coordinate System ===\n");

  // Test Case 1: Small image (512x512)
  console.log("Test 1: Small Image (512x512)");
  testImageSize(512, 512);

  // Test Case 2: Medium image (1024x768)
  console.log("\nTest 2: Medium Image (1024x768)");
  testImageSize(1024, 768);

  // Test Case 3: Large image (2048x1536)
  console.log("\nTest 3: Large Image (2048x1536)");
  testImageSize(2048, 1536);

  // Test Case 4: Ultra-wide image (2560x800)
  console.log("\nTest 4: Ultra-wide Image (2560x800)");
  testImageSize(2560, 800);

  // Test Case 5: Ultra-tall image (800x2560)
  console.log("\nTest 5: Ultra-tall Image (800x2560)");
  testImageSize(800, 2560);

  console.log("\n=== Coordinate System Test Complete ===");
}

function testImageSize(actualWidth, actualHeight) {
  // Simulate display constraints
  const maxWidth = 900;
  const maxHeight = 620;
  const margin = 18;

  // Calculate display scale (as done in editor.js)
  const displayScale = Math.min(
    (maxWidth - margin * 2) / actualWidth,
    (maxHeight - margin * 3) / actualHeight,
    1
  );

  // Test different zoom levels
  const zoomLevels = [0.5, 1, 2, 3];

  console.log(`  Original: ${actualWidth}x${actualHeight}`);
  console.log(`  Display Scale: ${displayScale.toFixed(3)}`);
  console.log(`  Display Size: ${Math.round(actualWidth * displayScale)}x${Math.round(actualHeight * displayScale)}`);

  zoomLevels.forEach(userZoom => {
    const displayWidth = Math.round(actualWidth * displayScale * userZoom);
    const displayHeight = Math.round(actualHeight * displayScale * userZoom);

    console.log(`  Zoom ${userZoom}x: ${displayWidth}x${displayHeight}`);

    // Test coordinate transformations
    testCoordinateTransformation(actualWidth, actualHeight, displayScale, userZoom);
  });
}

function testCoordinateTransformation(actualWidth, actualHeight, displayScale, userZoom) {
  // Simulate canvas offset (centering)
  const canvasOffsetX = 0;
  const canvasOffsetY = 0;

  // Test points: corners and center
  const testPoints = [
    { name: "Top-Left", rawX: 0, rawY: 0 },
    { name: "Top-Right", rawX: actualWidth * displayScale * userZoom, rawY: 0 },
    { name: "Bottom-Left", rawX: 0, rawY: actualHeight * displayScale * userZoom },
    { name: "Bottom-Right", rawX: actualWidth * displayScale * userZoom, rawY: actualHeight * displayScale * userZoom },
    { name: "Center", rawX: (actualWidth * displayScale * userZoom) / 2, rawY: (actualHeight * displayScale * userZoom) / 2 }
  ];

  testPoints.forEach(point => {
    // Convert from display coordinates to image coordinates
    const displayX = (point.rawX - canvasOffsetX) / (displayScale * userZoom);
    const displayY = (point.rawY - canvasOffsetY) / (displayScale * userZoom);

    // Apply boundary constraints
    const clampedX = Math.max(0, Math.min(displayX, actualWidth));
    const clampedY = Math.max(0, Math.min(displayY, actualHeight));

    console.log(`    ${point.name}: raw=(${point.rawX.toFixed(1)},${point.rawY.toFixed(1)}) -> image=(${clampedX.toFixed(1)},${clampedY.toFixed(1)})`);
  });
}

// Test control point detection
function testControlPointDetection() {
  console.log("\n=== Testing Control Point Detection ===");

  const testCases = [
    { name: "Small Image", width: 512, height: 512 },
    { name: "Large Image", width: 2048, height: 1536 }
  ];

  testCases.forEach(testCase => {
    console.log(`\n${testCase.name} (${testCase.width}x${testCase.height}):`);

    // Simulate different zoom levels
    const zoomLevels = [0.5, 1, 2];
    const displayScale = 0.5; // Fixed for testing

    zoomLevels.forEach(userZoom => {
      const threshold = 16 / (displayScale * userZoom);
      console.log(`  Zoom ${userZoom}x: threshold=${threshold.toFixed(2)} pixels (in original image space)`);
    });
  });
}

// Run tests
if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment
  module.exports = { testCoordinateSystem, testControlPointDetection };
} else {
  // Browser environment
  testCoordinateSystem();
  testControlPointDetection();
}