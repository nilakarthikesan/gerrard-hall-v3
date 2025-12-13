import * as THREE from 'three';

/**
 * Alpha Animation Engine
 * 
 * Implements Frank's vision of point-level interpolation:
 * - Each point stores origin (ox, oy, oz) and animates toward target (x, y, z)
 * - Alpha blending creates motion trails
 * - Smooth easing for "flock" motion effect
 * 
 * Key Concepts:
 * - Keyframe 1: All constituent cluster points (ba_output, child merged clusters)
 * - Keyframe 2: The merged cluster points
 * - Points interpolate from keyframe 1 → keyframe 2 during merges
 */
export class AlphaAnimationEngine {
    constructor(clusters, eventEngine) {
        this.clusters = clusters;
        this.eventEngine = eventEngine;
        
        // Animation timing
        this.FADE_DURATION = 800;       // Fade in/out duration
        this.MORPH_DURATION = 2000;     // Point interpolation duration
        this.FINAL_DURATION = 3000;     // Final merge duration
        
        // Layout - same as timeline view
        this.LEVEL_SPACING = 30;
        this.CLUSTER_SPACING = 20;
        
        // Camera reference
        this.camera = null;
        this.orbitControls = null;
        this.cameraDistance = 100;
        
        // State tracking
        this.visibleClusters = new Set();
        this.clusterLevels = new Map();
        this.clusterPositions = new Map();
        this.maxLevel = 0;
        
        // Morph cloud - the special point cloud for interpolation effects
        this.morphCloud = null;
        this.morphPositions = null;  // Current positions (animated)
        this.morphOrigins = null;    // Starting positions
        this.morphTargets = null;    // Target positions
        this.morphColors = null;     // Point colors
        this.morphProgress = 0;      // 0 to 1
        this.isMorphing = false;
        
        // Animation state
        this.activeAnimations = [];
        
        // Focus settings
        this.FOCUS_DISTANCE = 80;
        this.FOCUS_DURATION = 400;
        
        // Blend info callback
        this.onBlendUpdate = null;
    }
    
    setCamera(camera, orbitControls, distance) {
        this.camera = camera;
        this.orbitControls = orbitControls;
        this.cameraDistance = distance;
    }
    
    /**
     * Create the morph cloud - a special point cloud used for interpolation effects
     * This cloud contains all points that are currently being morphed/interpolated
     */
    createMorphCloud(scene) {
        // Start with capacity for largest possible merge (all points)
        const maxPoints = 50000;
        
        const geometry = new THREE.BufferGeometry();
        this.morphPositions = new Float32Array(maxPoints * 3);
        this.morphOrigins = new Float32Array(maxPoints * 3);
        this.morphTargets = new Float32Array(maxPoints * 3);
        this.morphColors = new Float32Array(maxPoints * 3);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(this.morphPositions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(this.morphColors, 3));
        
        const material = new THREE.PointsMaterial({
            size: 2.5,
            vertexColors: true,
            transparent: true,
            opacity: 1.0,
            sizeAttenuation: false,
            depthWrite: true,
            blending: THREE.NormalBlending  // Normal blending for proper RGB colors
        });
        
        this.morphCloud = new THREE.Points(geometry, material);
        this.morphCloud.visible = false;
        this.morphCloud.frustumCulled = false;
        
        scene.add(this.morphCloud);
        
        // Track how many points are active
        this.morphPointCount = 0;
    }
    
    /**
     * Compute cluster positions based on hierarchy
     * Leaves at bottom (level 0), root at top
     * 
     * SAME AS TIMELINE VIEW - clusters spread out in tree structure
     * with camera zooming to where action happens
     */
    initializePositions() {
        console.log("=== ALPHA ENGINE: INITIALIZING POSITIONS ===");
        console.log(`Total clusters to position: ${this.clusters.size}`);
        
        // First, assign levels based on path depth
        for (const [path, cluster] of this.clusters) {
            const depth = (path.match(/\//g) || []).length;
            
            let level;
            if (cluster.type === 'ba_output') {
                level = 0;
            } else {
                level = 1;
            }
            
            this.clusterLevels.set(path, level);
        }
        
        // Compute proper levels by traversing from root
        const rootCluster = this.clusters.get('merged');
        if (rootCluster) {
            const queue = [{ cluster: rootCluster, depth: 0 }];
            const visited = new Set();
            
            while (queue.length > 0) {
                const { cluster, depth } = queue.shift();
                if (!cluster || visited.has(cluster.path)) continue;
                visited.add(cluster.path);
                
                this.clusterLevels.set(cluster.path, depth);
                
                if (cluster.children) {
                    for (const child of cluster.children) {
                        if (child && !visited.has(child.path)) {
                            queue.push({ cluster: child, depth: depth + 1 });
                        }
                    }
                }
            }
            
            console.log(`BFS visited ${visited.size} clusters from root`);
            
            // Handle orphans
            for (const [path, cluster] of this.clusters) {
                if (!visited.has(path)) {
                    const pathDepth = (path.match(/\//g) || []).length;
                    this.clusterLevels.set(path, pathDepth + 1);
                }
            }
        }
        
        // Find max depth and invert to get levels
        const maxDepth = Math.max(...this.clusterLevels.values());
        this.maxLevel = maxDepth;
        console.log(`Max depth: ${maxDepth}`);
        
        // Invert depths to levels (root at top, leaves at bottom)
        for (const [path, depth] of this.clusterLevels) {
            const level = maxDepth - depth;
            this.clusterLevels.set(path, level);
        }
        
        // Group clusters by level
        const levelGroups = new Map();
        for (const [path, level] of this.clusterLevels) {
            if (!levelGroups.has(level)) {
                levelGroups.set(level, []);
            }
            levelGroups.get(level).push(path);
        }
        
        // Assign X, Y positions within each level
        const totalHeight = this.maxLevel * this.LEVEL_SPACING;
        const yOffset = -totalHeight / 2;
        
        console.log(`\nLevel assignments (total height: ${totalHeight}, yOffset: ${yOffset}):`);
        
        for (let level = 0; level <= this.maxLevel; level++) {
            const paths = levelGroups.get(level) || [];
            const count = paths.length;
            const totalWidth = (count - 1) * this.CLUSTER_SPACING;
            const startX = -totalWidth / 2;
            
            const y = level * this.LEVEL_SPACING + yOffset;
            
            paths.forEach((path, i) => {
                const x = startX + i * this.CLUSTER_SPACING;
                
                this.clusterPositions.set(path, { x, y, z: 0, level });
                
                const cluster = this.clusters.get(path);
                if (cluster && cluster.group) {
                    cluster.group.position.set(x, y, 0);
                }
            });
            
            console.log(`  Level ${level}: ${count} clusters at Y=${y.toFixed(0)}`);
        }
        
        // Initially hide all clusters
        for (const [path, cluster] of this.clusters) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.transparent = true;
                cluster.pointCloud.material.opacity = 1;
            }
        }
        
        console.log(`\nInitialized ${this.clusters.size} clusters across ${this.maxLevel + 1} levels`);
        console.log(`Positions computed: ${this.clusterPositions.size}`);
    }
    
    /**
     * Apply event state instantly (for scrubbing/jumping)
     */
    applyEventInstant(eventIndex) {
        // Hide all clusters first
        for (const cluster of this.clusters.values()) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
            }
        }
        this.visibleClusters.clear();
        
        // Hide morph cloud
        if (this.morphCloud) {
            this.morphCloud.visible = false;
        }
        
        // Apply all events up to this one
        const events = this.eventEngine.events;
        for (let i = 0; i <= eventIndex; i++) {
            const event = events[i];
            
            if (event.type === 'fade_in') {
                const cluster = this.clusters.get(event.path);
                if (cluster?.pointCloud) {
                    const pos = this.clusterPositions.get(event.path);
                    if (pos) cluster.group.position.set(pos.x, pos.y, pos.z);
                    cluster.pointCloud.visible = true;
                    this.visibleClusters.add(event.path);
                }
            } else if (event.type === 'leaf_promotion' || event.type === 'parent_merge' || event.type === 'final_merge') {
                // Hide inputs
                for (const inputPath of event.inputs) {
                    const cluster = this.clusters.get(inputPath);
                    if (cluster?.pointCloud) {
                        cluster.pointCloud.visible = false;
                    }
                    this.visibleClusters.delete(inputPath);
                }
                
                // Show output
                const outCluster = this.clusters.get(event.path);
                if (outCluster?.pointCloud) {
                    const pos = this.clusterPositions.get(event.path);
                    if (pos) outCluster.group.position.set(pos.x, pos.y, pos.z);
                    outCluster.pointCloud.visible = true;
                    this.visibleClusters.add(event.path);
                }
            }
        }
    }
    
    /**
     * Play an event with animations
     */
    playEvent(eventIndex, direction = 1) {
        const event = this.eventEngine.events[eventIndex];
        if (!event) return;
        
        console.log(`\n▶ Playing Event ${event.number}: ${event.type} - ${event.path}`);
        
        switch (event.type) {
            case 'fade_in':
                this.animateFadeIn(event);
                break;
            case 'leaf_promotion':
                this.animateLeafPromotion(event);
                break;
            case 'parent_merge':
                this.animateParentMerge(event);
                break;
            case 'final_merge':
                this.animateFinalMerge(event);
                break;
        }
    }
    
    /**
     * Type A: Fade In - cluster appears with glow effect
     * Uses proper positioned layout and zooms camera to the cluster
     */
    animateFadeIn(event) {
        const cluster = this.clusters.get(event.path);
        if (!cluster?.pointCloud) return;
        
        // Position cluster at its assigned position
        const pos = this.clusterPositions.get(event.path);
        if (pos) {
            cluster.group.position.set(pos.x, pos.y, pos.z || 0);
        }
        
        // Zoom camera to this cluster
        const targetPos = pos ? new THREE.Vector3(pos.x, pos.y, 0) : new THREE.Vector3(0, 0, 0);
        this.focusCamera(targetPos, this.FOCUS_DISTANCE);
        
        // Fade in
        cluster.pointCloud.visible = true;
        cluster.pointCloud.material.transparent = true;
        cluster.pointCloud.material.opacity = 0;
        
        this.activeAnimations.push({
            type: 'fadeIn',
            target: cluster.pointCloud,
            startOpacity: 0,
            endOpacity: 1,
            startTime: performance.now(),
            duration: this.FADE_DURATION,
            onComplete: () => {
                cluster.pointCloud.material.opacity = 1;
                this.visibleClusters.add(event.path);
                this.updateBlendInfo('Fade Complete', 100);
            }
        });
        
        this.updateBlendInfo('Fading In', 0);
    }
    
    /**
     * Type B: Leaf Promotion - ba_output becomes merged
     * 
     * WHAT IS LEAF PROMOTION?
     * When a cluster has no children to merge with, its ba_output
     * simply becomes the merged result. The data is the same,
     * it's just "promoted" up in the hierarchy.
     * 
     * Visually: Points rise from ba_output position to merged position
     */
    animateLeafPromotion(event) {
        console.log(`  Leaf Promotion: ${event.path}`);
        
        const mergedCluster = this.clusters.get(event.path);
        const baPath = event.inputs.find(p => p.endsWith('ba_output') || p === 'ba_output');
        const baCluster = baPath ? this.clusters.get(baPath) : null;
        
        if (!mergedCluster?.pointCloud || !baCluster?.pointCloud) {
            console.warn('Missing clusters for leaf promotion');
            return;
        }
        
        // Get positions
        const baPos = this.clusterPositions.get(baPath);
        const mergedPos = this.clusterPositions.get(event.path);
        
        // Focus camera between the two positions
        const focusX = ((baPos?.x || 0) + (mergedPos?.x || 0)) / 2;
        const focusY = ((baPos?.y || 0) + (mergedPos?.y || 0)) / 2;
        this.focusCamera(new THREE.Vector3(focusX, focusY, 0), this.FOCUS_DISTANCE * 0.8);
        
        // Set up point morphing with proper positions
        this.setupMorphFromCluster(baCluster, baPos, mergedCluster, mergedPos);
        
        // Hide original ba_output
        baCluster.pointCloud.visible = false;
        this.visibleClusters.delete(baPath);
        
        // Start morph animation
        this.startMorphAnimation(this.MORPH_DURATION, () => {
            // Morph complete - show merged cluster, hide morph cloud
            this.morphCloud.visible = false;
            mergedCluster.pointCloud.visible = true;
            const pos = mergedPos || { x: 0, y: 0, z: 0 };
            mergedCluster.group.position.set(pos.x, pos.y, pos.z || 0);
            this.visibleClusters.add(event.path);
        });
        
        this.updateBlendInfo('Leaf Promotion', 0);
    }
    
    /**
     * Type C: Parent Merge - multiple clusters merge together
     * 
     * WHAT IS PARENT MERGE?
     * When a cluster has children, its merged result = ba_output + all child merged clusters.
     * All input points flow together into the combined result.
     */
    animateParentMerge(event) {
        console.log(`  Parent Merge: ${event.path}`);
        console.log(`    Inputs: ${event.inputs.join(', ')}`);
        
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster?.pointCloud) {
            console.warn('Missing merged cluster');
            return;
        }
        
        const mergedPos = this.clusterPositions.get(event.path);
        
        // Collect all input clusters with their positions
        const inputClusters = [];
        let focusX = 0, focusY = 0;
        for (const inputPath of event.inputs) {
            const cluster = this.clusters.get(inputPath);
            const pos = this.clusterPositions.get(inputPath);
            if (cluster?.pointCloud) {
                inputClusters.push({ cluster, pos, path: inputPath });
                focusX += pos?.x || 0;
                focusY += pos?.y || 0;
            }
        }
        
        if (inputClusters.length === 0) {
            console.warn('No input clusters found');
            return;
        }
        
        // Focus camera on the center of all inputs
        focusX /= inputClusters.length;
        focusY /= inputClusters.length;
        this.focusCamera(new THREE.Vector3(focusX, focusY, 0), this.FOCUS_DISTANCE * 1.2);
        
        // Set up multi-cluster morph with proper positions
        this.setupMorphFromMultiple(inputClusters, mergedCluster, mergedPos);
        
        // Hide input clusters
        for (const { cluster, path } of inputClusters) {
            cluster.pointCloud.visible = false;
            this.visibleClusters.delete(path);
        }
        
        // Start morph animation
        this.startMorphAnimation(this.MORPH_DURATION, () => {
            this.morphCloud.visible = false;
            mergedCluster.pointCloud.visible = true;
            const pos = mergedPos || { x: 0, y: 0, z: 0 };
            mergedCluster.group.position.set(pos.x, pos.y, pos.z || 0);
            this.visibleClusters.add(event.path);
        });
        
        this.updateBlendInfo('Parent Merge', 0);
    }
    
    /**
     * Type D: Final Merge - grand finale with all points converging
     * 
     * WHAT IS FINAL MERGE?
     * The root "merged" folder combines all top-level clusters (C_1, C_2, C_3, C_4)
     * plus the root ba_output into the complete Gerrard Hall building.
     */
    animateFinalMerge(event) {
        console.log(`  FINAL MERGE!`);
        
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster?.pointCloud) return;
        
        const mergedPos = this.clusterPositions.get(event.path);
        
        // Collect all inputs with positions
        const inputClusters = [];
        for (const inputPath of event.inputs) {
            const cluster = this.clusters.get(inputPath);
            const pos = this.clusterPositions.get(inputPath);
            if (cluster?.pointCloud) {
                inputClusters.push({ cluster, pos, path: inputPath });
            }
        }
        
        // Wide view first to see all inputs
        this.focusCamera(new THREE.Vector3(0, this.maxLevel * this.LEVEL_SPACING / 2, 0), this.FOCUS_DISTANCE * 2);
        
        // Set up morph with positions
        this.setupMorphFromMultiple(inputClusters, mergedCluster, mergedPos);
        
        // Hide inputs
        for (const { cluster, path } of inputClusters) {
            cluster.pointCloud.visible = false;
            this.visibleClusters.delete(path);
        }
        
        // Start morph with longer duration
        this.startMorphAnimation(this.FINAL_DURATION, () => {
            this.morphCloud.visible = false;
            mergedCluster.pointCloud.visible = true;
            const pos = mergedPos || { x: 0, y: 0, z: 0 };
            mergedCluster.group.position.set(pos.x, pos.y, pos.z || 0);
            this.visibleClusters.add(event.path);
            
            // Zoom in for final view
            this.focusCamera(new THREE.Vector3(pos.x, pos.y, 0), this.FOCUS_DISTANCE * 0.5);
            
            this.updateBlendInfo('Complete!', 100);
        });
        
        this.updateBlendInfo('FINAL MERGE', 0);
    }
    
    /**
     * Set up morph cloud from a single input cluster to merged cluster
     */
    setupMorphFromCluster(inputCluster, inputPos, targetCluster, targetPos) {
        const inputGeom = inputCluster.pointCloud.geometry;
        const targetGeom = targetCluster.pointCloud.geometry;
        
        const inputPositions = inputGeom.attributes.position.array;
        const inputColors = inputGeom.attributes.color.array;
        const targetPositions = targetGeom.attributes.position.array;
        
        const inputCount = inputGeom.attributes.position.count;
        const targetCount = targetGeom.attributes.position.count;
        
        // Use the larger count (we might need to duplicate points)
        const pointCount = Math.max(inputCount, targetCount);
        this.morphPointCount = pointCount;
        
        // Offset for cluster positions
        const inputOffset = new THREE.Vector3(inputPos?.x || 0, inputPos?.y || 0, inputPos?.z || 0);
        const targetOffset = new THREE.Vector3(targetPos?.x || 0, targetPos?.y || 0, targetPos?.z || 0);
        
        for (let i = 0; i < pointCount; i++) {
            const i3 = i * 3;
            
            // Input point (wrap if needed)
            const inputIdx = (i % inputCount) * 3;
            this.morphOrigins[i3] = inputPositions[inputIdx] + inputOffset.x;
            this.morphOrigins[i3 + 1] = inputPositions[inputIdx + 1] + inputOffset.y;
            this.morphOrigins[i3 + 2] = inputPositions[inputIdx + 2] + inputOffset.z;
            
            // Target point (wrap if needed)
            const targetIdx = (i % targetCount) * 3;
            this.morphTargets[i3] = targetPositions[targetIdx] + targetOffset.x;
            this.morphTargets[i3 + 1] = targetPositions[targetIdx + 1] + targetOffset.y;
            this.morphTargets[i3 + 2] = targetPositions[targetIdx + 2] + targetOffset.z;
            
            // Start at origin
            this.morphPositions[i3] = this.morphOrigins[i3];
            this.morphPositions[i3 + 1] = this.morphOrigins[i3 + 1];
            this.morphPositions[i3 + 2] = this.morphOrigins[i3 + 2];
            
            // Colors from input
            const colorIdx = (i % inputCount) * 3;
            this.morphColors[i3] = inputColors[colorIdx];
            this.morphColors[i3 + 1] = inputColors[colorIdx + 1];
            this.morphColors[i3 + 2] = inputColors[colorIdx + 2];
        }
        
        // Update geometry
        this.morphCloud.geometry.setDrawRange(0, pointCount);
        this.morphCloud.geometry.attributes.position.needsUpdate = true;
        this.morphCloud.geometry.attributes.color.needsUpdate = true;
        this.morphCloud.visible = true;
    }
    
    /**
     * Set up morph cloud from multiple input clusters to merged cluster
     */
    setupMorphFromMultiple(inputClusters, targetCluster, targetPos) {
        const targetGeom = targetCluster.pointCloud.geometry;
        const targetPositions = targetGeom.attributes.position.array;
        const targetCount = targetGeom.attributes.position.count;
        
        // Collect all input points
        let totalInputPoints = 0;
        const inputData = [];
        
        for (const { cluster, pos } of inputClusters) {
            const geom = cluster.pointCloud.geometry;
            const positions = geom.attributes.position.array;
            const colors = geom.attributes.color.array;
            const count = geom.attributes.position.count;
            
            inputData.push({
                positions,
                colors,
                count,
                offset: new THREE.Vector3(pos?.x || 0, pos?.y || 0, pos?.z || 0)
            });
            
            totalInputPoints += count;
        }
        
        // Use the larger of total input or target
        const pointCount = Math.max(totalInputPoints, targetCount);
        this.morphPointCount = pointCount;
        
        const targetOffset = new THREE.Vector3(targetPos?.x || 0, targetPos?.y || 0, targetPos?.z || 0);
        
        // Fill morph arrays
        let pointIndex = 0;
        
        // First, add all input points
        for (const data of inputData) {
            for (let i = 0; i < data.count; i++) {
                if (pointIndex >= pointCount) break;
                
                const i3 = pointIndex * 3;
                const src3 = i * 3;
                
                // Origin from input
                this.morphOrigins[i3] = data.positions[src3] + data.offset.x;
                this.morphOrigins[i3 + 1] = data.positions[src3 + 1] + data.offset.y;
                this.morphOrigins[i3 + 2] = data.positions[src3 + 2] + data.offset.z;
                
                // Target - map to corresponding target point (wrapping if needed)
                const targetIdx = (pointIndex % targetCount) * 3;
                this.morphTargets[i3] = targetPositions[targetIdx] + targetOffset.x;
                this.morphTargets[i3 + 1] = targetPositions[targetIdx + 1] + targetOffset.y;
                this.morphTargets[i3 + 2] = targetPositions[targetIdx + 2] + targetOffset.z;
                
                // Start at origin
                this.morphPositions[i3] = this.morphOrigins[i3];
                this.morphPositions[i3 + 1] = this.morphOrigins[i3 + 1];
                this.morphPositions[i3 + 2] = this.morphOrigins[i3 + 2];
                
                // Colors from input
                this.morphColors[i3] = data.colors[src3];
                this.morphColors[i3 + 1] = data.colors[src3 + 1];
                this.morphColors[i3 + 2] = data.colors[src3 + 2];
                
                pointIndex++;
            }
        }
        
        // If we need more points to match target, duplicate from inputs
        while (pointIndex < targetCount) {
            const i3 = pointIndex * 3;
            const srcIdx = pointIndex % totalInputPoints;
            
            // Find which input this maps to
            let cumulative = 0;
            let srcData = inputData[0];
            let localIdx = srcIdx;
            
            for (const data of inputData) {
                if (srcIdx < cumulative + data.count) {
                    srcData = data;
                    localIdx = srcIdx - cumulative;
                    break;
                }
                cumulative += data.count;
            }
            
            const src3 = localIdx * 3;
            
            this.morphOrigins[i3] = srcData.positions[src3] + srcData.offset.x;
            this.morphOrigins[i3 + 1] = srcData.positions[src3 + 1] + srcData.offset.y;
            this.morphOrigins[i3 + 2] = srcData.positions[src3 + 2] + srcData.offset.z;
            
            const targetIdx = pointIndex * 3;
            this.morphTargets[i3] = targetPositions[targetIdx] + targetOffset.x;
            this.morphTargets[i3 + 1] = targetPositions[targetIdx + 1] + targetOffset.y;
            this.morphTargets[i3 + 2] = targetPositions[targetIdx + 2] + targetOffset.z;
            
            this.morphPositions[i3] = this.morphOrigins[i3];
            this.morphPositions[i3 + 1] = this.morphOrigins[i3 + 1];
            this.morphPositions[i3 + 2] = this.morphOrigins[i3 + 2];
            
            this.morphColors[i3] = srcData.colors[src3];
            this.morphColors[i3 + 1] = srcData.colors[src3 + 1];
            this.morphColors[i3 + 2] = srcData.colors[src3 + 2];
            
            pointIndex++;
        }
        
        // Update geometry
        this.morphCloud.geometry.setDrawRange(0, pointCount);
        this.morphCloud.geometry.attributes.position.needsUpdate = true;
        this.morphCloud.geometry.attributes.color.needsUpdate = true;
        this.morphCloud.visible = true;
    }
    
    /**
     * Start the morph animation
     */
    startMorphAnimation(duration, onComplete) {
        this.isMorphing = true;
        this.morphProgress = 0;
        
        this.activeAnimations.push({
            type: 'morph',
            startTime: performance.now(),
            duration: duration,
            onComplete: () => {
                this.isMorphing = false;
                this.morphProgress = 1;
                if (onComplete) onComplete();
            }
        });
    }
    
    /**
     * Cubic easing for smooth "flock" motion (from Frank's sample)
     */
    easeInOutCubic(x) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }
    
    /**
     * Focus camera on position
     */
    focusCamera(targetPos, distance = this.FOCUS_DISTANCE) {
        if (!this.camera || !this.orbitControls) return;
        
        this.activeAnimations.push({
            type: 'cameraFocus',
            startPos: this.camera.position.clone(),
            endPos: new THREE.Vector3(targetPos.x, targetPos.y, distance),
            startTarget: this.orbitControls.target.clone(),
            endTarget: targetPos.clone(),
            startTime: performance.now(),
            duration: this.FOCUS_DURATION
        });
    }
    
    /**
     * Update blend info display
     */
    updateBlendInfo(state, progress) {
        if (this.onBlendUpdate) {
            this.onBlendUpdate(state, progress);
        }
    }
    
    /**
     * Animation update loop
     */
    update(dt) {
        const now = performance.now();
        
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(1, elapsed / anim.duration);
            const eased = this.easeInOutCubic(progress);
            
            switch (anim.type) {
                case 'fadeIn': {
                    const opacity = anim.startOpacity + (anim.endOpacity - anim.startOpacity) * eased;
                    anim.target.material.opacity = opacity;
                    this.updateBlendInfo('Fading In', Math.floor(progress * 100));
                    break;
                }
                
                case 'morph': {
                    this.morphProgress = eased;
                    
                    // Update all morph positions
                    for (let j = 0; j < this.morphPointCount; j++) {
                        const j3 = j * 3;
                        this.morphPositions[j3] = this.morphOrigins[j3] + 
                            (this.morphTargets[j3] - this.morphOrigins[j3]) * eased;
                        this.morphPositions[j3 + 1] = this.morphOrigins[j3 + 1] + 
                            (this.morphTargets[j3 + 1] - this.morphOrigins[j3 + 1]) * eased;
                        this.morphPositions[j3 + 2] = this.morphOrigins[j3 + 2] + 
                            (this.morphTargets[j3 + 2] - this.morphOrigins[j3 + 2]) * eased;
                    }
                    
                    this.morphCloud.geometry.attributes.position.needsUpdate = true;
                    this.updateBlendInfo('Morphing', Math.floor(progress * 100));
                    break;
                }
                
                case 'cameraFocus': {
                    this.camera.position.lerpVectors(anim.startPos, anim.endPos, eased);
                    this.orbitControls.target.lerpVectors(anim.startTarget, anim.endTarget, eased);
                    break;
                }
            }
            
            if (progress >= 1) {
                if (anim.onComplete) anim.onComplete();
                this.activeAnimations.splice(i, 1);
            }
        }
    }
}

