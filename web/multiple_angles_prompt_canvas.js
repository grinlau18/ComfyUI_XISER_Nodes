/**
 * @file multiple_angles_prompt_canvas.js
 * @description ComfyUI 多角度相机提示词节点的画布管理模块
 * 基于原始HTML实现重构为 addDOMWidget 架构
 * 参考: /Volumes/gx_files_disk/AIGC/ComfyUI开发/可视化相机提示词.html
 * @author grinlau18
 */

/* global THREE */

// 参数映射表（从原始HTML复制）
const PARAM_MAP = {
  azimuth: {
    "-180": "back view",
    "-135": "back-left quarter view",
    "-90": "left side view",
    "-45": "front-left quarter view",
    "0": "front view",
    "45": "front-right quarter view",
    "90": "right side view",
    "135": "back-right quarter view",
    "180": "back view",
  },
  elevation: {
    "-30": "low-angle shot",
    "0": "eye-level shot",
    "30": "elevated shot",
    "60": "high-angle shot",
  },
  distance: {
    "0.6": "close-up",
    "1.0": "medium shot",
    "1.8": "wide shot",
  },
};

// 中文描述映射
const CHINESE_DESC_MAP = {
  "front view": "正面视角",
  "front-right quarter view": "右前四分之一视角",
  "right side view": "右侧视角",
  "back-right quarter view": "右后四分之一视角",
  "back view": "背面视角",
  "back-left quarter view": "左后四分之一视角",
  "left side view": "左侧视角",
  "front-left quarter view": "左前四分之一视角"
};

/**
 * 节流函数
 * @param {Function} func 要执行的函数
 * @param {number} delay 延迟时间（毫秒）
 * @returns {Function} 节流后的函数
 */
function throttle(func, delay) {
  let lastCall = 0;
  let timeoutId = null;
  return function(...args) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    if (remaining <= 0) {
      lastCall = now;
      func.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        func.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * 找到最近的水平旋转预设角度（考虑360°循环）
 */
function findNearestAzimuthPreset(angle) {
  const presets = [-180, -135, -90, -45, 0, 45, 90, 135, 180];
  let nearest = presets[0];
  let minDiff = 360; // 最大可能差
  for (let preset of presets) {
    // 计算循环角度差（考虑360°循环）
    let diff = Math.abs(angle - preset);
    diff = Math.min(diff, 360 - diff);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = preset;
    }
  }
  return nearest;
}

/**
 * 找到最近的仰角预设值
 */
function findNearestElevationPreset(angle) {
  const presets = [-30, 0, 30, 60];
  let nearest = presets[0];
  let minDiff = Math.abs(angle - nearest);
  for (let preset of presets) {
    const diff = Math.abs(angle - preset);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = preset;
    }
  }
  return nearest;
}

/**
 * 找到最近的距离预设值
 */
function findNearestDistancePreset(distance) {
  const presets = [0.6, 1.0, 1.8];
  let nearest = presets[0];
  let minDiff = Math.abs(distance - nearest);
  for (let preset of presets) {
    const diff = Math.abs(distance - preset);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = preset;
    }
  }
  return nearest;
}

/**
 * 生成提示词
 */
export function generatePrompt(node) {
  const azimuth = node.properties.azimuth || 0;
  const elevation = node.properties.elevation || 0;
  const distance = node.properties.distance || 1.0;

  const nearestAzimuth = findNearestAzimuthPreset(azimuth);
  const azText = PARAM_MAP.azimuth[String(nearestAzimuth)] || "front view";

  const nearestElevation = findNearestElevationPreset(elevation);
  const elText = PARAM_MAP.elevation[String(nearestElevation)] || "eye-level shot";

  const nearestDistance = findNearestDistancePreset(distance);
  const disText = PARAM_MAP.distance[nearestDistance.toFixed(1)] || "medium shot";

  const prompt = `<sks> ${azText} ${elText} ${disText}`;

  // 更新节点属性
  node.properties.prompt = prompt;

  // 更新提示词显示
  const promptOutput = document.getElementById(`promptOutput_${node.id}`);
  if (promptOutput) {
    promptOutput.value = prompt;
  }

  return prompt;
}

/**
 * 更新预览信息
 */
function updatePreviewInfo(node, azimuth, elevation, distance) {
  const previewInfo = document.getElementById(`previewInfo_${node.id}`);
  if (previewInfo) {
    previewInfo.textContent = `水平角: ${azimuth}° | 仰角: ${elevation}° | 距离: ${distance}`;
  }
}

/**
 * 更新相机位置
 */
export function updateCameraPosition(threejs, azimuth, elevation, distance) {
  if (!threejs || !threejs.camera || !threejs.planeMesh) return;

  // 兼容性检查：确保MathUtils存在
  if (!THREE.MathUtils) {
    THREE.MathUtils = { degToRad: (deg) => deg * Math.PI / 180 };
  }

  const azRad = THREE.MathUtils.degToRad(azimuth);
  const elRad = THREE.MathUtils.degToRad(elevation);
  const scale = distance * 10;

  threejs.camera.position.x = Math.cos(elRad) * Math.sin(azRad) * scale;
  threejs.camera.position.y = Math.sin(elRad) * scale;
  threejs.camera.position.z = Math.cos(elRad) * Math.cos(azRad) * scale;
  threejs.camera.lookAt(0, 0, 0);

  // 请求重新渲染
  if (threejs.requestRender) {
    threejs.requestRender();
  }

  // 更新预览信息
  updatePreviewInfo({ id: threejs.nodeId }, azimuth, elevation, distance);

  // 更新背面效果
  updateBacksideOverlay({ id: threejs.nodeId }, azimuth, threejs.planeMesh);
}

/**
 * 更新背面效果（根据原始HTML实现）
 */
function updateBacksideOverlay(node, azimuth, planeMesh) {
  // 当角度大于90°或小于-90°时视为背面，将贴图颜色变暗30%
  const absAzimuth = Math.abs(azimuth);
  const isBackside = absAzimuth > 90; // 大于90°或小于-90°视为背面

  if (planeMesh) {
    if (isBackside) {
      // 背面时贴图颜色变暗30%（70%亮度）
      planeMesh.material.color.setHex(0xB3B3B3); // 70%亮度，叠加30%黑色
    } else {
      // 正面时恢复白色
      planeMesh.material.color.setHex(0xFFFFFF); // 白色
    }
    planeMesh.material.needsUpdate = true;
  }
}

/**
 * 创建参数控制区
 */
function createParamControls(node) {
  const paramControls = document.createElement('div');
  paramControls.className = `xiser-multiple-angles-param-controls xiser-multiple-angles-param-controls-${node.id}`;
  paramControls.style.cssText = `
    margin-bottom: 10px;
    padding: 8px 0;
  `;

  // 水平旋转角
  const azimuthGroup = document.createElement('div');
  azimuthGroup.className = 'control-group';
  azimuthGroup.innerHTML = `
    <div class="control-header">
      <label for="azimuth_${node.id}">水平旋转角 (Azimuth):</label>
      <div class="param-value" id="azimuthValue_${node.id}">${node.properties.azimuth || 0}°</div>
    </div>
    <input type="range" id="azimuth_${node.id}" min="-180" max="180" step="1" value="${node.properties.azimuth || 0}">
  `;
  paramControls.appendChild(azimuthGroup);

  // 垂直仰角
  const elevationGroup = document.createElement('div');
  elevationGroup.className = 'control-group';
  elevationGroup.innerHTML = `
    <div class="control-header">
      <label for="elevation_${node.id}">垂直仰角 (Elevation):</label>
      <div class="param-value" id="elevationValue_${node.id}">${node.properties.elevation || 0}°</div>
    </div>
    <input type="range" id="elevation_${node.id}" min="-30" max="60" step="1" value="${node.properties.elevation || 0}">
  `;
  paramControls.appendChild(elevationGroup);

  // 拍摄距离
  const distanceGroup = document.createElement('div');
  distanceGroup.className = 'control-group';
  distanceGroup.innerHTML = `
    <div class="control-header">
      <label for="distance_${node.id}">拍摄距离 (Distance):</label>
      <div class="param-value" id="distanceValue_${node.id}">${node.properties.distance || 1.0}</div>
    </div>
    <input type="range" id="distance_${node.id}" min="0.6" max="1.8" step="0.1" value="${node.properties.distance || 1.0}">
  `;
  paramControls.appendChild(distanceGroup);

  return paramControls;
}

/**
 * 创建提示词显示区
 */
function createPromptDisplay(node) {
  const promptDisplay = document.createElement('div');
  promptDisplay.className = `xiser-multiple-angles-prompt-display xiser-multiple-angles-prompt-display-${node.id}`;
  promptDisplay.style.cssText = `
    padding: 8px 0;
  `;

  promptDisplay.innerHTML = `
    <h3>output prompt</h3>
    <textarea class="prompt-output" id="promptOutput_${node.id}" readonly></textarea>
  `;

  return promptDisplay;
}

/**
 * 更新水平旋转角显示
 */
export function updateAzimuthDisplay(node, value) {
  const azimuth = Number(value);
  node.properties.azimuth = azimuth;

  const nearestPreset = findNearestAzimuthPreset(azimuth);
  const presetText = PARAM_MAP.azimuth[String(nearestPreset)] || "front view";
  const chineseDesc = CHINESE_DESC_MAP[presetText] || "正面视角";

  const azimuthValue = document.getElementById(`azimuthValue_${node.id}`);
  if (azimuthValue) {
    azimuthValue.textContent = `${value}°`;
  }

  // 更新3D预览
  if (node._threejs) {
    const elevation = node.properties.elevation || 0;
    const distance = node.properties.distance || 1.0;
    updateCameraPosition(node._threejs, azimuth, elevation, distance);
  }

  // 生成提示词
  generatePrompt(node);

  // 更新节点widget数据
  updateNodeWidgetData(node);

  return azimuth;
}

/**
 * 更新仰角显示
 */
export function updateElevationDisplay(node, value) {
  const elevation = Number(value);
  node.properties.elevation = elevation;

  const elevationValue = document.getElementById(`elevationValue_${node.id}`);
  if (elevationValue) {
    elevationValue.textContent = `${value}°`;
  }

  // 更新3D预览
  if (node._threejs) {
    const azimuth = node.properties.azimuth || 0;
    const distance = node.properties.distance || 1.0;
    updateCameraPosition(node._threejs, azimuth, elevation, distance);
  }

  // 生成提示词
  generatePrompt(node);

  // 更新节点widget数据
  updateNodeWidgetData(node);

  return elevation;
}

/**
 * 更新距离显示
 */
export function updateDistanceDisplay(node, value) {
  const distance = Number(value);
  node.properties.distance = distance;

  const distanceValue = document.getElementById(`distanceValue_${node.id}`);
  if (distanceValue) {
    distanceValue.textContent = `${value}`;
  }

  // 更新3D预览
  if (node._threejs) {
    const azimuth = node.properties.azimuth || 0;
    const elevation = node.properties.elevation || 0;
    updateCameraPosition(node._threejs, azimuth, elevation, distance);
  }

  // 生成提示词
  generatePrompt(node);

  // 更新节点widget数据
  updateNodeWidgetData(node);

  return distance;
}

/**
 * 更新节点widget数据
 */
function updateNodeWidgetData(node) {
  if (node.widgets) {
    // 创建或更新camera_preview widget数据
    const cameraWidget = node.widgets.find(w => w.name === "camera_preview");
    if (cameraWidget) {
      cameraWidget.value = JSON.stringify({
        azimuth: node.properties.azimuth,
        elevation: node.properties.elevation,
        distance: node.properties.distance,
        prompt: node.properties.prompt || ''
      });
    }

    // 触发节点更新
    if (node.onWidgetChanged) {
      node.onWidgetChanged();
    }
  }
}

/**
 * 初始化Three.js场景（基于原始HTML实现）
 */
function initThreeJSScene(node, previewArea, loadingTip) {
  try {
    // 检查Three.js是否可用
    if (typeof THREE === 'undefined') {
      loadingTip.textContent = '3D预览不可用 (Three.js未加载)';
      loadingTip.style.color = '#dc3545';
      console.warn('Three.js not available for node', node.id);
      return;
    }

    // 获取预览区域尺寸
    const width = previewArea.clientWidth || 400;
    const height = previewArea.clientHeight || 300;

    // 创建渲染器
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 1); // 黑色背景

    // 添加到预览区域
    const canvas = renderer.domElement;
    canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 5;
      background: transparent;
    `;
    previewArea.appendChild(canvas);

    // 创建场景
    const scene = new THREE.Scene();

    // 添加坐标系
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // 添加透视网格（提供空间参考）
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x888888);
    gridHelper.position.y = -3; // 将网格放在平面下方3个单位，提供深度感
    scene.add(gridHelper);

    // 添加参考平面（基于原始HTML）
    const planeGeometry = new THREE.PlaneGeometry(8, 6);
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    });
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
    scene.add(planeMesh);

    // 创建红色线框表示拍摄画面（基于原始HTML）
    let frameLine = null;
    let frameOriginalScale = { x: 1, y: 1 };

    // 创建线框几何体（使用与平面相同的尺寸）
    const frameGeometry = new THREE.PlaneGeometry(8, 6);
    const edges = new THREE.EdgesGeometry(frameGeometry);

    // 创建线框材质（红色，始终在前端显示）
    const frameMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000, // 红色
      linewidth: 4, // 线宽
      depthTest: false, // 禁用深度测试，始终显示在最前面
      transparent: true, // 允许透明度
      opacity: 0.8 // 稍微透明
    });

    // 创建线框对象
    frameLine = new THREE.LineSegments(edges, frameMaterial);

    // 将线框放置在平面稍前方
    frameLine.position.z = 0.01;

    // 设置渲染顺序，确保线框在平面之后渲染（显示在前面）
    planeMesh.renderOrder = 0;
    frameLine.renderOrder = 1;

    // 禁用深度写入，确保线框始终可见
    frameLine.material.depthWrite = false;

    // 存储原始缩放比例
    frameOriginalScale.x = 1; // 初始宽度缩放
    frameOriginalScale.y = 1; // 高度缩放

    // 应用初始缩放
    frameLine.scale.x = frameOriginalScale.x;
    frameLine.scale.y = frameOriginalScale.y;

    // 将线框添加到场景中
    scene.add(frameLine);

    // 创建相机
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);

    // 设置初始相机位置
    const azimuth = node.properties.azimuth || 0;
    const elevation = node.properties.elevation || 0;
    const distance = node.properties.distance || 1.0;

    // 兼容MathUtils
    if (!THREE.MathUtils) {
      THREE.MathUtils = { degToRad: (deg) => deg * Math.PI / 180 };
    }

    const azRad = THREE.MathUtils.degToRad(azimuth);
    const elRad = THREE.MathUtils.degToRad(elevation);
    const scale = distance * 10;

    camera.position.x = Math.cos(elRad) * Math.sin(azRad) * scale;
    camera.position.y = Math.sin(elRad) * scale;
    camera.position.z = Math.cos(elRad) * Math.cos(azRad) * scale;
    camera.lookAt(0, 0, 0);

    // 按需渲染系统（增强版，包含红色线框更新）
    const threejs = {
      renderer,
      scene,
      camera,
      planeMesh,
      gridHelper, // 透视网格引用
      frameLine,
      frameOriginalScale: { x: 1, y: 1 },
      nodeId: node.id,
      nodeRef: node, // 存储节点引用以便访问属性
      needsRender: true,
      animationFrameId: null,
      isAnimating: false,

      // 更新红色线框位置和缩放
      updateFrameLine: function() {
        if (this.frameLine && this.camera) {
          // 使线框始终面向相机
          this.frameLine.lookAt(this.camera.position);

          // 根据相机距离调整缩放，保持屏幕固定大小
          // 基准距离为1.0，缩放与距离成正比
          const distance = this.nodeRef?.properties?.distance || 1.0;
          this.frameLine.scale.x = this.frameOriginalScale.x * distance;
          this.frameLine.scale.y = this.frameOriginalScale.y * distance;
        }
      },

      scheduleRender: function() {
        if (this.animationFrameId === null && this.needsRender) {
          this.animationFrameId = requestAnimationFrame(() => {
            // 渲染前更新红色线框
            this.updateFrameLine();
            this.renderer.render(this.scene, this.camera);
            this.animationFrameId = null;
            this.needsRender = false;
          });
        }
      },

      requestRender: function() {
        this.needsRender = true;
        this.scheduleRender();
      },

      // 启动连续动画循环（用于平滑的线框更新）
      startAnimation: function() {
        if (this.isAnimating) return;
        this.isAnimating = true;

        const animate = () => {
          if (!this.isAnimating) return;

          // 更新线框
          this.updateFrameLine();

          // 如果needsRender为true，则渲染
          if (this.needsRender) {
            this.renderer.render(this.scene, this.camera);
            this.needsRender = false;
          }

          // 继续动画循环
          if (this.isAnimating) {
            requestAnimationFrame(animate);
          }
        };

        // 启动动画循环
        animate();
      },

      // 停止动画循环
      stopAnimation: function() {
        this.isAnimating = false;
      }
    };

    // 存储frameOriginalScale到threejs对象（从局部变量复制）
    threejs.frameOriginalScale = frameOriginalScale;

    // 绑定上下文确保函数中的this正确
    threejs.scheduleRender = threejs.scheduleRender.bind(threejs);
    threejs.requestRender = threejs.requestRender.bind(threejs);
    threejs.updateFrameLine = threejs.updateFrameLine.bind(threejs);
    threejs.startAnimation = threejs.startAnimation.bind(threejs);
    threejs.stopAnimation = threejs.stopAnimation.bind(threejs);

    // 初始渲染
    threejs.scheduleRender();

    // 启动动画循环（用于平滑的线框更新）
    setTimeout(() => {
      threejs.startAnimation();
    }, 100);

    // 隐藏加载提示
    loadingTip.style.display = 'none';

    // 存储Three.js对象到节点实例
    node._threejs = threejs;

    // 更新预览信息
    updatePreviewInfo(node, azimuth, elevation, distance);

    // 初始化背面效果
    updateBacksideOverlay(node, azimuth, planeMesh);

    console.log(`Node ${node.id} Three.js initialized successfully`);

  } catch (error) {
    console.error(`Node ${node.id} Three.js initialization error:`, error);
    if (loadingTip) {
      loadingTip.textContent = '3D预览初始化失败';
      loadingTip.style.color = '#dc3545';
    }
  }
}

/**
 * 设置事件监听器
 */
function setupEventListeners(node) {
  // 使用节流的更新函数
  const throttledUpdateAzimuth = throttle((value) => {
    updateAzimuthDisplay(node, value);
  }, 16); // ~60fps

  const throttledUpdateElevation = throttle((value) => {
    updateElevationDisplay(node, value);
  }, 16);

  const throttledUpdateDistance = throttle((value) => {
    updateDistanceDisplay(node, value);
  }, 16);

  // 水平旋转滑块
  const azimuthSlider = document.getElementById(`azimuth_${node.id}`);
  if (azimuthSlider) {
    // 实时更新滑块值显示（不节流）
    azimuthSlider.addEventListener('input', (e) => {
      const value = e.target.value;
      const azimuthValue = document.getElementById(`azimuthValue_${node.id}`);
      if (azimuthValue) {
        azimuthValue.textContent = `${value}°`;
      }
      throttledUpdateAzimuth(value);
    });
  }

  // 仰角滑块
  const elevationSlider = document.getElementById(`elevation_${node.id}`);
  if (elevationSlider) {
    elevationSlider.addEventListener('input', (e) => {
      const value = e.target.value;
      const elevationValue = document.getElementById(`elevationValue_${node.id}`);
      if (elevationValue) {
        elevationValue.textContent = `${value}°`;
      }
      throttledUpdateElevation(value);
    });
  }

  // 距离滑块
  const distanceSlider = document.getElementById(`distance_${node.id}`);
  if (distanceSlider) {
    distanceSlider.addEventListener('input', (e) => {
      const value = e.target.value;
      const distanceValue = document.getElementById(`distanceValue_${node.id}`);
      if (distanceValue) {
        distanceValue.textContent = `${value}`;
      }
      throttledUpdateDistance(value);
    });
  }
}

/**
 * 清理资源
 */
export function cleanupNodeResources(node) {
  if (node._threejs) {
    // 停止动画循环
    if (node._threejs.stopAnimation) {
      node._threejs.stopAnimation();
    }

    // 取消挂起的渲染帧
    if (node._threejs.animationFrameId !== null && node._threejs.animationFrameId !== undefined) {
      cancelAnimationFrame(node._threejs.animationFrameId);
    }

    // 清理Three.js渲染器
    if (node._threejs.renderer) {
      node._threejs.renderer.dispose();
      const canvas = node._threejs.renderer.domElement;
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    }

    // 清理场景对象
    if (node._threejs.scene) {
      const cleanupObject = (obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      };

      node._threejs.scene.traverse(cleanupObject);
    }
  }
  node._threejs = null;
}

/**
 * 设置相机预览画布
 * @param {Object} node - 节点实例
 */
export function setupCameraPreview(node) {
  // 创建主容器
  const container = document.createElement('div');
  container.className = `xiser-multiple-angles-container xiser-multiple-angles-container-${node.id}`;
  container.style.cssText = `
    width: 100%;
    height: 100%;
    padding: 10px;
    box-sizing: border-box;
    font-family: Arial, sans-serif;
  `;

  // 创建预览区域（固定高度，响应式宽度）
  const previewArea = document.createElement('div');
  previewArea.className = `xiser-multiple-angles-preview-area xiser-multiple-angles-preview-area-${node.id}`;
  previewArea.style.cssText = `
    width: 100%;
    height: 300px;
    margin: 0 auto 15px;
    overflow: visible;
    position: relative;
    background: transparent;
  `;

  // 加载提示
  const loadingTip = document.createElement('div');
  loadingTip.className = `xiser-multiple-angles-loading-tip xiser-multiple-angles-loading-tip-${node.id}`;
  loadingTip.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #666;
    font-size: 14px;
    z-index: 5;
  `;
  loadingTip.textContent = '正在初始化3D预览...';
  previewArea.appendChild(loadingTip);

  // 预览信息
  const previewInfo = document.createElement('div');
  previewInfo.className = `xiser-multiple-angles-preview-info xiser-multiple-angles-preview-info-${node.id}`;
  previewInfo.style.cssText = `
    position: absolute;
    bottom: 8px;
    left: 8px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    z-index: 1000;
  `;
  previewInfo.textContent = '水平角: 0° | 仰角: 0° | 距离: 1.0';
  previewArea.appendChild(previewInfo);

  container.appendChild(previewArea);

  // 参数控制区
  const paramControls = createParamControls(node);
  container.appendChild(paramControls);

  // 提示词显示区
  const promptDisplay = createPromptDisplay(node);
  container.appendChild(promptDisplay);

  // 注册DOM widget
  node.addDOMWidget('camera_preview', 'Camera Preview', container, {
    serialize: true,
    getValue: () => {
      return {
        azimuth: node.properties.azimuth || 0,
        elevation: node.properties.elevation || 0,
        distance: node.properties.distance || 1.0,
        prompt: node.properties.prompt || '',
        node_id: node.id.toString()
      };
    },
    setValue: (value) => {
      // 恢复状态
      if (value.node_id === node.id.toString()) {
        node.properties.azimuth = value.azimuth || 0;
        node.properties.elevation = value.elevation || 0;
        node.properties.distance = value.distance || 1.0;
        node.properties.prompt = value.prompt || '';

        // 更新UI
        updateAzimuthDisplay(node, node.properties.azimuth);
        updateElevationDisplay(node, node.properties.elevation);
        updateDistanceDisplay(node, node.properties.distance);

        // 更新提示词显示
        const promptOutput = document.getElementById(`promptOutput_${node.id}`);
        if (promptOutput && node.properties.prompt) {
          promptOutput.value = node.properties.prompt;
        }
      }
    }
  });

  // 延迟初始化Three.js（确保DOM已渲染）
  setTimeout(() => {
    initThreeJSScene(node, previewArea, loadingTip);
    setupEventListeners(node);

    // 初始化显示
    updateAzimuthDisplay(node, node.properties.azimuth || 0);
    updateElevationDisplay(node, node.properties.elevation || 0);
    updateDistanceDisplay(node, node.properties.distance || 1.0);
    generatePrompt(node);
  }, 100);
}

/**
 * 加载图像纹理并应用到平面
 * @param {Object} node - 节点实例
 * @param {string} imageUrl - 图像URL
 */
export function loadImageTexture(node, imageUrl) {
  // 检查THREE是否可用
  if (typeof THREE === 'undefined') {
    console.error(`Node ${node.id} THREE is not defined, cannot load texture`);
    return;
  }

  if (!node._threejs || !node._threejs.planeMesh) {
    console.warn(`Node ${node.id} Three.js scene not ready for texture loading`);
    return;
  }

  const threejs = node._threejs;
  const planeMesh = threejs.planeMesh;

  // 创建纹理加载器
  const textureLoader = new THREE.TextureLoader();
  textureLoader.crossOrigin = 'anonymous'; // 允许跨域

  textureLoader.load(
    imageUrl,
    (texture) => {
      console.log(`Node ${node.id} texture loaded successfully`);
      // 更新平面材质
      if (planeMesh.material) {
        planeMesh.material.map = texture;
        // 设置纹理wrap模式，防止重复
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        planeMesh.material.needsUpdate = true;

        // 计算图片宽高比，调整平面缩放以维持原图比例
        const aspect = texture.image.width / texture.image.height;
        // 平面原始尺寸为8×6，高度6不变，调整宽度
        // 原HTML中使用4×6平面，所以调整因子为(6/4)=1.5，但这里平面是8×6，所以调整因子为(6/8)=0.75
        // 保持高度6不变，调整宽度：宽度缩放 = aspect * (原始高度/原始宽度) = aspect * (6/8) = aspect * 0.75
        planeMesh.scale.x = aspect * 0.75; // 8×6平面的宽度缩放因子
        console.log(`Node ${node.id} image aspect ratio: ${aspect}, plane scale.x adjusted to: ${planeMesh.scale.x}`);

        // 如果存在红色线框，更新其缩放
        if (threejs.frameLine) {
          // 线框原始缩放比例存储
          if (!threejs.frameOriginalScale) {
            threejs.frameOriginalScale = { x: 1, y: 1 };
          }
          // 线框与平面使用相同的基础几何体尺寸，所以应用相同的缩放
          threejs.frameOriginalScale.x = aspect * 0.75;
          threejs.frameOriginalScale.y = 1;

          threejs.frameLine.scale.x = threejs.frameOriginalScale.x;
          threejs.frameLine.scale.y = threejs.frameOriginalScale.y;
          console.log(`Node ${node.id} frame overlay updated with aspect ratio: ${aspect}`);
        }
      }
      // 触发重新渲染
      if (threejs.requestRender) {
        threejs.requestRender();
      }
    },
    undefined, // onProgress callback (optional)
    (error) => {
      console.error(`Node ${node.id} failed to load texture:`, error);
    }
  );
}

/**
 * 从节点输出中提取图像URL并更新纹理
 * @param {Object} node - 节点实例
 * @param {Object} output - 节点输出数据
 */
export function updatePlaneTextureFromOutput(node, output) {
  // 从输出中提取图像数据
  const imageData = output?.xiser_images || output?.images;
  if (!imageData || !Array.isArray(imageData) || imageData.length === 0) {
    console.log(`Node ${node.id} no image data in output`);
    return;
  }

  // 使用第一个图像
  const imgInfo = imageData[0];
  if (!imgInfo.filename && !imgInfo.name) {
    console.warn(`Node ${node.id} image info missing filename`);
    return;
  }

  // 构建图像URL（参考image_preview.js中的逻辑）
  const api = window.app?.api || window.api;
  if (!api) {
    console.error('API not available');
    return;
  }

  const params = new URLSearchParams();
  let filename = imgInfo.filename || imgInfo.name || imgInfo.file;
  let subfolder = imgInfo.subfolder || imgInfo.folder || imgInfo.dir;
  let type = imgInfo.type || imgInfo.folder_type || 'temp';

  if (filename) params.set('filename', filename);
  if (subfolder) params.set('subfolder', subfolder);
  params.set('type', type);

  const imageUrl = `${api.apiURL('/view')}?${params.toString()}`;
  console.log(`Node ${node.id} image URL: ${imageUrl}`);

  // 加载纹理
  loadImageTexture(node, imageUrl);
}