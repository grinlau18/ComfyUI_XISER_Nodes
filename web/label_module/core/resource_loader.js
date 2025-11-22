/**
 * 资源加载器模块
 */
import { logger } from './logger.js';
import { CODEMIRROR_RESOURCES, CODEMIRROR_FALLBACKS, MARKED_SCRIPT, MARKED_FALLBACK } from './constants.js';

// Set of loaded resources to prevent duplicate loading
const loadedResources = new Set();

/**
 * Loads a JavaScript script with caching, CDN fallback, and retries.
 * @param {string} src - The script URL.
 * @param {string} [fallbackSrc] - Fallback CDN URL.
 * @param {number} [retries=2] - Number of retries.
 * @returns {Promise<void>} Resolves when loaded, rejects on failure.
 */
export async function loadScript(src, fallbackSrc, retries = 2) {
    if (loadedResources.has(src)) {
        logger.debug(`Script already loaded: ${src}`);
        return Promise.resolve();
    }

    for (let i = 0; i < retries; i++) {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.type = "application/javascript";
                script.src = src;
                script.onload = () => {
                    loadedResources.add(src);
                    resolve();
                };
                script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
                document.head.appendChild(script);
            });
            return;
        } catch (e) {
            if (i === retries - 1 && fallbackSrc) {
                logger.warn(`Retrying with fallback: ${fallbackSrc}`);
                await loadScript(fallbackSrc);
                return;
            }
        }
    }
    throw new Error(`Failed to load script after retries: ${src}`);
}

/**
 * Loads a CSS stylesheet with caching and CDN fallback.
 * @param {string} href - The CSS URL.
 * @param {string} [fallbackHref] - Fallback CDN URL.
 * @returns {Promise<void>} Resolves when loaded or on fallback success.
 */
export function loadCss(href, fallbackHref) {
    if (loadedResources.has(href)) {
        logger.debug(`CSS already loaded: ${href}`);
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        if (!navigator.onLine) {
            loadedResources.add(href);
            logger.info(`Offline mode, skipping CSS load: ${href}`);
            resolve();
            return;
        }

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = href;
        link.onload = () => {
            loadedResources.add(href);
            resolve();
        };
        link.onerror = () => {
            if (fallbackHref) {
                logger.warn(`CSS load failed, trying fallback: ${fallbackHref}`);
                loadCss(fallbackHref).then(resolve).catch(reject);
            } else {
                loadedResources.add(href);
                logger.info(`No fallback for CSS, continuing: ${href}`);
                resolve();
            }
        };
        document.head.appendChild(link);
    });
}

/**
 * Asynchronously loads CodeMirror resources in sequence.
 * @param {string} mode - The editor mode ('html' or 'markdown').
 * @returns {Promise<void>} Resolves when all critical resources are loaded.
 */
export async function loadCodeMirrorResources(mode = 'html') {
    const criticalResources = [
        {
            type: "script",
            src: CODEMIRROR_RESOURCES.SCRIPT,
            fallback: CODEMIRROR_FALLBACKS.SCRIPT
        },
        {
            type: "css",
            src: CODEMIRROR_RESOURCES.CSS,
            fallback: CODEMIRROR_FALLBACKS.CSS
        },
        {
            type: "css",
            src: CODEMIRROR_RESOURCES.THEME,
            fallback: CODEMIRROR_FALLBACKS.THEME
        }
    ];

    // Load critical resources sequentially to ensure dependencies
    for (const res of criticalResources) {
        try {
            if (res.type === "script") {
                await loadScript(res.src, res.fallback);
                logger.info(`Loaded script: ${res.src}`);
            } else {
                await loadCss(res.src, res.fallback);
                logger.info(`Loaded CSS: ${res.src}`);
            }
        } catch (e) {
            logger.error(`Failed to load resource: ${res.src}`, e);
            throw e;
        }
    }

    // Load mode-specific resources after CodeMirror is available
    try {
        // 确保CodeMirror对象已经定义
        if (typeof CodeMirror === 'undefined') {
            // 等待CodeMirror对象可用（最多等待5秒）
            await new Promise((resolve, reject) => {
                const maxWaitTime = 5000; // 5秒超时
                const startTime = Date.now();

                const checkCodeMirror = () => {
                    if (typeof CodeMirror !== 'undefined') {
                        resolve();
                    } else if (Date.now() - startTime > maxWaitTime) {
                        reject(new Error('CodeMirror not available after timeout'));
                    } else {
                        setTimeout(checkCodeMirror, 50);
                    }
                };
                checkCodeMirror();
            });
        }

        // Load mode-specific script
        if (mode === 'html') {
            await loadScript(CODEMIRROR_RESOURCES.HTML_MODE, CODEMIRROR_FALLBACKS.HTML_MODE);
            logger.info("Loaded htmlmixed.js");
            if (window.XISER_CodeMirrorModes?.htmlmixed) {
                try {
                    window.XISER_CodeMirrorModes.htmlmixed(CodeMirror);
                    logger.debug("Registered cached htmlmixed mode");
                } catch (err) {
                    logger.warn("Failed to register cached htmlmixed mode:", err);
                }
            }
        } else if (mode === 'markdown') {
            await loadScript(CODEMIRROR_RESOURCES.MARKDOWN_MODE, CODEMIRROR_FALLBACKS.MARKDOWN_MODE);
            logger.info("Loaded markdown.js");
        }
    } catch (e) {
        logger.error(`Failed to load ${mode} mode script`, e);
        throw e;
    }
}

/**
 * Loads the Markdown parser (marked.js) for richer Markdown rendering.
 * @returns {Promise<void>}
 */
export async function loadMarkedResources() {
    try {
        await loadScript(MARKED_SCRIPT, MARKED_FALLBACK);
        logger.info(`Loaded Markdown parser: ${MARKED_SCRIPT}`);
    } catch (e) {
        logger.warn(`Failed to load marked.js: ${e.message}`);
    }
}

/**
 * Checks if a resource is already loaded
 * @param {string} src - The resource URL
 * @returns {boolean}
 */
export function isResourceLoaded(src) {
    return loadedResources.has(src);
}
