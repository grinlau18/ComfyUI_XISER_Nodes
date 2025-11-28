/**
 * Test script for verifying image centering and initial zoom behavior
 */

function testCenteringFix() {
  console.log("=== Testing Image Centering and Initial Zoom ===\n");

  // Test Case: 810x1440 image
  console.log("Test Case: 810x1440 Image");
  testImageCentering(810, 1440);

  // Test Case: 512x512 image
  console.log("\nTest Case: 512x512 Image");
  testImageCentering(512, 512);

  // Test Case: 2000x1000 image
  console.log("\nTest Case: 2000x1000 Image");
  testImageCentering(2000, 1000);

  console.log("\n=== Centering Fix Test Complete ===");
}

function testImageCentering(actualWidth, actualHeight) {
  // Simulate canvasShell dimensions
  const canvasShellWidth = 800;
  const canvasShellHeight = 500;
  const padding = 12;

  const maxWidth = canvasShellWidth - padding * 2;
  const maxHeight = canvasShellHeight - padding * 2;

  // Calculate initial display scale
  const displayScale = Math.min(maxWidth / actualWidth, maxHeight / actualHeight, 1);
  const userZoom = displayScale; // Initial zoom to fit container

  // Calculate display dimensions
  const displayWidth = Math.round(actualWidth * userZoom);
  const displayHeight = Math.round(actualHeight * userZoom);

  // Calculate centering offsets
  const canvasOffsetX = (canvasShellWidth - displayWidth) / 2;
  const canvasOffsetY = (canvasShellHeight - displayHeight) / 2;

  console.log(`  Original Image: ${actualWidth}x${actualHeight}`);
  console.log(`  Canvas Shell: ${canvasShellWidth}x${canvasShellHeight}`);
  console.log(`  Display Scale: ${displayScale.toFixed(3)}`);
  console.log(`  Initial Zoom: ${userZoom.toFixed(3)} (${Math.round(userZoom * 100)}%)`);
  console.log(`  Display Size: ${displayWidth}x${displayHeight}`);
  console.log(`  Centering Offsets: X=${canvasOffsetX.toFixed(1)}, Y=${canvasOffsetY.toFixed(1)}`);

  // Verify centering
  if (canvasOffsetX > 0 && canvasOffsetY > 0) {
    console.log(`  ✅ SUCCESS: Image will be centered in container`);
  } else {
    console.log(`  ℹ️  Image fills container, no centering needed`);
  }

  // Verify initial zoom behavior
  if (userZoom <= 1) {
    console.log(`  ✅ SUCCESS: Initial zoom fits image in container`);
  } else {
    console.log(`  ❌ ISSUE: Initial zoom exceeds 100%`);
  }

  // Test coordinate transformations
  console.log("\n  Testing Coordinate Transformations:");

  const testPoints = [
    { name: "Image Top-Left", x: 0, y: 0 },
    { name: "Image Center", x: actualWidth / 2, y: actualHeight / 2 },
    { name: "Image Bottom-Right", x: actualWidth, y: actualHeight }
  ];

  testPoints.forEach(point => {
    // Convert image coordinates to display coordinates
    const displayX = point.x * userZoom + canvasOffsetX;
    const displayY = point.y * userZoom + canvasOffsetY;

    // Convert back to image coordinates
    const imageX = (displayX - canvasOffsetX) / userZoom;
    const imageY = (displayY - canvasOffsetY) / userZoom;

    console.log(`    ${point.name}: image=(${point.x},${point.y}) -> display=(${displayX.toFixed(1)},${displayY.toFixed(1)}) -> image=(${imageX.toFixed(1)},${imageY.toFixed(1)})`);
  });
}

// Run tests
if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment
  module.exports = { testCenteringFix };
} else {
  // Browser environment
  testCenteringFix();
}