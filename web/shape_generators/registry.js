/**
 * Shape Generator Registry
 * Manages all available shape generators and provides a unified interface
 */

import { CircleGenerator } from './circle.js';
import { PolygonGenerator } from './polygon.js';
import { StarGenerator } from './star.js';
import { HeartGenerator } from './heart.js';
import { FlowerGenerator } from './flower.js';
import { WavyGenerator } from './wavy.js';
import { SpiralGenerator } from './spiral.js';
import { SunburstGenerator } from './sunburst.js';
import { TextGenerator } from './text.js';

export class ShapeRegistry {
    static generators = new Map();

    /**
     * Register a shape generator
     * @param {Class} generatorClass - Shape generator class
     */
    static register(generatorClass) {
        if (generatorClass.type && generatorClass.generate) {
            this.generators.set(generatorClass.type, generatorClass);
            console.log(`Shape generator registered: ${generatorClass.type}`);
        } else {
            console.error('Invalid shape generator class:', generatorClass);
        }
    }

    /**
     * Get shape generator by type
     * @param {string} type - Shape type
     * @returns {Class|null} Shape generator class or null if not found
     */
    static getGenerator(type) {
        return this.generators.get(type) || null;
    }

    /**
     * Get all available shape types
     * @returns {string[]} Array of shape types
     */
    static getAvailableTypes() {
        return Array.from(this.generators.keys());
    }

    /**
     * Generate shape using the appropriate generator
     * @param {string} type - Shape type
     * @param {Object} params - Shape parameters
     * @param {number} size - Base size
     * @returns {Object|null} Shape data or null if generator not found
     */
    static generateShape(type, params, size) {
        const generator = this.getGenerator(type);
        if (generator) {
            return generator.generate(params, size);
        }
        console.error(`Shape generator not found for type: ${type}`);
        return null;
    }

    /**
     * Get parameter controls for a shape type
     * @param {string} type - Shape type
     * @param {HTMLElement} container - Container element
     * @param {Object} shapeParams - Current shape parameters
     * @param {Function} onParamChange - Callback when parameters change
     */
    static getParameterControls(type, container, shapeParams, onParamChange) {
        const generator = this.getGenerator(type);
        if (generator && generator.getParameterControls) {
            generator.getParameterControls(container, shapeParams, onParamChange);
        }
    }
}

// Register built-in shape generators
ShapeRegistry.register(CircleGenerator);
ShapeRegistry.register(PolygonGenerator);
ShapeRegistry.register(StarGenerator);
ShapeRegistry.register(HeartGenerator);
ShapeRegistry.register(FlowerGenerator);
ShapeRegistry.register(WavyGenerator);
ShapeRegistry.register(SpiralGenerator);
ShapeRegistry.register(SunburstGenerator);
ShapeRegistry.register(TextGenerator);

export default ShapeRegistry;
