/**
 * 防抖工具函数
 */

/**
 * Debounces a function to limit execution rate.
 * @param {Function} fn - The function to debounce.
 * @param {number} wait - The wait time in milliseconds.
 * @returns {Function} The debounced function.
 */
export function debounce(fn, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}