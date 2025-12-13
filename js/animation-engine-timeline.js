import * as THREE from 'three';

/**
 * Timeline Animation Engine v3
 * Shows clusters at different vertical levels (like Slab View)
 * But uses the 38-event system for precise control
 * 
 * Key Fix: ALL clusters are positioned at (0,0,0) initially
 * Only visible clusters are shown - positions are computed but
 * clusters appear at CENTER so user can always see them
 * 
 * Levels: Leaves at bottom (Y=0), Root at top (Y=max)
 * Animation: Clusters rise upward and merge at each level
 */
export class TimelineAnimationEngine {
    constructor(clusters, eventEngine) {
        this.clusters = clusters;
        this.eventEngine = eventEngine;
        this.activeAnimations = [];
        
        // Animation timing (ms)
        this.FADE_IN_DURATION = 600;
        this.RISE_DURATION = 1200;
        this.MERGE_DURATION = 1500;
        this.FINAL_MERGE_DURATION = 2500;
        
        // Layout parameters - REDUCED for better visibility
        this.LEVEL_SPACING = 30;  // Smaller vertical distance between levels
        this.CLUSTER_SPACING = 20; // Smaller horizontal spacing
        
        // Camera reference
        this.camera = null;
        this.orbitControls = null;
        this.cameraDistance = 100;
        
        // Track state
        this.visibleClusters = new Set();
        this.clusterLevels = new Map();  // path -> level
        this.clusterPositions = new Map(); // path -> {x, y, z}
        this.maxLevel = 0;
        
        // Debug mode
        this.debug = true;
        
        // Dynamic camera focus settings
        this.FOCUS_ZOOM_DURATION = 400;  // Time to zoom to focus point
        this.FOCUS_DISTANCE = 80;        // How close to zoom when focusing on action
        this.OVERVIEW_DISTANCE = 300;    // Distance for overview shots
    }
    
    setCamera(camera, orbitControls, distance) {
        this.camera = camera;
        this.orbitControls = orbitControls;
        this.cameraDistance = distance;
    }
    
    /**
     * Focus camera on a specific position with smooth animation
     * @param {THREE.Vector3} targetPos - Position to focus on
     * @param {number} distance - How close to zoom (optional, defaults to FOCUS_DISTANCE)
     * @param {number} duration - Animation duration in ms (optional)
     * @returns {Promise} Resolves when zoom is complete
     */
    focusCamera(targetPos, distance = this.FOCUS_DISTANCE, duration = this.FOCUS_ZOOM_DURATION) {
        return new Promise((resolve) => {
            if (!this.camera || !this.orbitControls) {
                resolve();
                return;
            }
            
            const startPos = this.camera.position.clone();
            const startTarget = this.orbitControls.target.clone();
            
            const endPos = new THREE.Vector3(targetPos.x, targetPos.y, distance);
            const endTarget = targetPos.clone();
            
            this.activeAnimations.push({
                type: 'cameraFocus',
                startPos: startPos,
                endPos: endPos,
                startTarget: startTarget,
                endTarget: endTarget,
                startTime: performance.now(),
                duration: duration,
                onComplete: resolve
            });
        });
    }
    
    /**
     * Focus on multiple positions (compute centroid and appropriate distance)
     * @param {Array<THREE.Vector3>} positions - Array of positions to include in view
     * @returns {Promise}
     */
    focusOnMultiple(positions) {
        if (positions.length === 0) return Promise.resolve();
        
        // Compute centroid
        const centroid = new THREE.Vector3();
        for (const pos of positions) {
            centroid.add(pos);
        }
        centroid.divideScalar(positions.length);
        
        // Compute required distance to see all positions
        let maxDist = 0;
        for (const pos of positions) {
            const dist = pos.distanceTo(centroid);
            maxDist = Math.max(maxDist, dist);
        }
        
        // Add padding and minimum distance
        const focusDistance = Math.max(this.FOCUS_DISTANCE, maxDist * 2 + 50);
        
        return this.focusCamera(centroid, focusDistance);
    }
    
    /**
     * Compute cluster positions based on hierarchy
     * Leaves at bottom (level 0), root at top
     * 
     * IMPORTANT: Position ALL clusters, not just those reachable from root
     */
    initializePositions() {
        console.log("=== INITIALIZING TIMELINE POSITIONS ===");
        console.log(`Total clusters to position: ${this.clusters.size}`);
        
        // First, assign levels based on path depth
        // This ensures ALL clusters get a level, not just those reachable from root
        for (const [path, cluster] of this.clusters) {
            // Count slashes to determine depth (more slashes = deeper in hierarchy)
            const depth = (path.match(/\//g) || []).length;
            
            // ba_output is at same level as its parent merged
            // So we need to handle ba_output specially
            let level;
            if (cluster.type === 'ba_output') {
                // ba_output clusters are at the bottom (level 0)
                level = 0;
            } else {
                // merged clusters are higher up based on their position in hierarchy
                // Root 'merged' has depth 0, children have depth 1, etc.
                level = 1; // Default for merged clusters
                
                // Deeper merged folders get lower levels
                // We'll refine this in the next pass
            }
            
            this.clusterLevels.set(path, level);
        }
        
        // Now compute proper levels by traversing from root
        const rootCluster = this.clusters.get('merged');
        if (rootCluster) {
            // BFS from root to compute proper depths
            const queue = [{ cluster: rootCluster, depth: 0 }];
            const visited = new Set();
            
            while (queue.length > 0) {
                const { cluster, depth } = queue.shift();
                if (!cluster || visited.has(cluster.path)) continue;
                visited.add(cluster.path);
                
                // Set level based on depth (will invert later)
                this.clusterLevels.set(cluster.path, depth);
                
                // Add children to queue
                if (cluster.children) {
                    for (const child of cluster.children) {
                        if (child && !visited.has(child.path)) {
                            queue.push({ cluster: child, depth: depth + 1 });
                        }
                    }
                }
            }
            
            console.log(`BFS visited ${visited.size} clusters from root`);
            
            // Find any clusters that weren't visited (orphans)
            const orphans = [];
            for (const [path, cluster] of this.clusters) {
                if (!visited.has(path)) {
                    orphans.push(path);
                    // Assign based on path depth
                    const pathDepth = (path.match(/\//g) || []).length;
                    this.clusterLevels.set(path, pathDepth + 1);
                }
            }
            if (orphans.length > 0) {
                console.warn(`Found ${orphans.length} orphan clusters:`, orphans);
            }
        }
        
        // Find max depth and invert to get levels (leaves at bottom)
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
        const yOffset = -totalHeight / 2; // Center vertically around Y=0
        
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
                
                // Position the cluster group
                const cluster = this.clusters.get(path);
                if (cluster && cluster.group) {
                    cluster.group.position.set(x, y, 0);
                }
            });
            
            console.log(`  Level ${level}: ${count} clusters at Y=${y.toFixed(0)}, paths: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? '...' : ''}`);
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
     * Apply event state instantly
     */
    applyEventInstant(eventIndex) {
        this.activeAnimations = [];
        
        // Hide all clusters and reset positions
        for (const [path, cluster] of this.clusters) {
            if (cluster.pointCloud) {
                cluster.pointCloud.visible = false;
                cluster.pointCloud.material.opacity = 1;
            }
            // Reset to stored position
            const pos = this.clusterPositions.get(path);
            if (pos && cluster.group) {
                cluster.group.position.set(pos.x, pos.y, pos.z);
            }
        }
        
        // Get visible clusters for this event
        const visible = this.eventEngine.getVisibleClustersAfterEvent(eventIndex);
        this.visibleClusters = new Set(visible);
        
        // Show visible clusters at their positions
        let visibleCount = 0;
        let missingCount = 0;
        
        for (const path of visible) {
            const cluster = this.clusters.get(path);
            if (cluster && cluster.pointCloud) {
                cluster.pointCloud.visible = true;
                cluster.pointCloud.material.opacity = 1;
                visibleCount++;
                
                // Debug: log position of visible clusters
                if (this.debug) {
                    const pos = this.clusterPositions.get(path);
                    if (pos) {
                        console.log(`  Showing ${path} at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
                    } else {
                        console.warn(`  WARNING: No position for ${path}`);
                    }
                }
            } else {
                console.warn(`  Missing cluster for path: ${path}`);
                missingCount++;
            }
        }
        
        const event = this.eventEngine.getEvent(eventIndex);
        console.log(`Applied event ${eventIndex + 1} [${event?.type || 'unknown'}]: ${visibleCount} clusters visible, ${missingCount} missing`);
    }
    
    /**
     * Play an event with animation
     */
    playEvent(eventIndex, direction = 1) {
        if (direction < 0) {
            this.applyEventInstant(eventIndex - 1 >= 0 ? eventIndex - 1 : 0);
            return;
        }
        
        const event = this.eventEngine.getEvent(eventIndex);
        if (!event) return;
        
        console.log(`Playing Event ${event.number} [${event.type}]: ${event.description}`);
        
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
     * Type A: Fade In - cluster appears at its level position
     * Camera zooms to the cluster location to show it clearly
     */
    animateFadeIn(event) {
        const cluster = this.clusters.get(event.path);
        if (!cluster || !cluster.pointCloud) return;
        
        const pos = this.clusterPositions.get(event.path);
        if (pos) {
            cluster.group.position.set(pos.x, pos.y, pos.z);
        }
        
        // First, zoom camera to focus on this cluster
        const targetPos = pos ? new THREE.Vector3(pos.x, pos.y, 0) : new THREE.Vector3(0, 0, 0);
        
        // Quick zoom to the action
        this.focusCamera(targetPos, this.FOCUS_DISTANCE, 300).then(() => {
            // Then fade in the cluster
            cluster.pointCloud.visible = true;
            cluster.pointCloud.material.transparent = true;
            cluster.pointCloud.material.opacity = 0;
            
            this.activeAnimations.push({
                type: 'fadeIn',
                target: cluster.pointCloud,
                startOpacity: 0,
                endOpacity: 1,
                startTime: performance.now(),
                duration: this.FADE_IN_DURATION,
                onComplete: () => {
                    cluster.pointCloud.material.opacity = 1;
                    this.visibleClusters.add(event.path);
                }
            });
        });
    }
    
    /**
     * Type B: Leaf Promotion - ba_output rises and transforms to merged
     * 
     * What this means:
     * - A "leaf" merged folder only has ba_output as input (no child merged folders)
     * - The ba_output "promotes" to become the merged result
     * - Visually: the ba_output cluster rises up one level and transforms
     * - The point cloud data is essentially the same, but now it's a "merged" result
     * 
     * Camera: Zooms to follow the rising cluster
     */
    animateLeafPromotion(event) {
        console.log(`  Leaf Promotion: ${event.path}`);
        
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster || !mergedCluster.pointCloud) {
            console.warn(`  Missing merged cluster: ${event.path}`);
            return;
        }
        
        const mergedPos = this.clusterPositions.get(event.path);
        if (!mergedPos) {
            console.warn(`  No position for merged cluster: ${event.path}`);
        }
        
        // Find ba_output input
        const baOutputPath = event.inputs.find(p => p.endsWith('ba_output') || p === 'ba_output');
        const baOutputCluster = baOutputPath ? this.clusters.get(baOutputPath) : null;
        const baOutputPos = baOutputPath ? this.clusterPositions.get(baOutputPath) : null;
        
        console.log(`  Input ba_output: ${baOutputPath}, visible: ${baOutputCluster?.pointCloud?.visible}`);
        
        // Zoom to the ba_output position first, then follow up to merged position
        const startFocusPos = baOutputPos ? new THREE.Vector3(baOutputPos.x, baOutputPos.y, 0) : new THREE.Vector3(0, 0, 0);
        const endFocusPos = mergedPos ? new THREE.Vector3(mergedPos.x, mergedPos.y, 0) : startFocusPos;
        
        // First zoom to the ba_output cluster
        this.focusCamera(startFocusPos, this.FOCUS_DISTANCE, 300).then(() => {
            if (baOutputCluster && baOutputCluster.pointCloud && baOutputCluster.pointCloud.visible) {
                const startPos = baOutputCluster.group.position.clone();
                const endPos = endFocusPos.clone();
                
                // Animate cluster rising
                this.activeAnimations.push({
                    type: 'rise',
                    cluster: baOutputCluster,
                    startPos: startPos.clone(),
                    endPos: endPos,
                    startTime: performance.now(),
                    duration: this.RISE_DURATION,
                    onComplete: () => {
                        baOutputCluster.pointCloud.visible = false;
                        baOutputCluster.group.position.copy(startPos); // Reset position
                        this.visibleClusters.delete(baOutputPath);
                    }
                });
                
                // Camera follows the rising cluster
                this.activeAnimations.push({
                    type: 'cameraFollow',
                    startPos: this.camera.position.clone(),
                    endPos: new THREE.Vector3(endFocusPos.x, endFocusPos.y, this.FOCUS_DISTANCE),
                    startTarget: this.orbitControls.target.clone(),
                    endTarget: endFocusPos.clone(),
                    startTime: performance.now(),
                    duration: this.RISE_DURATION
                });
            }
            
            // Show merged cluster after rise
            setTimeout(() => {
                if (mergedPos) {
                    mergedCluster.group.position.set(mergedPos.x, mergedPos.y, 0);
                }
                mergedCluster.pointCloud.visible = true;
                mergedCluster.pointCloud.material.transparent = true;
                mergedCluster.pointCloud.material.opacity = 0;
                
                this.activeAnimations.push({
                    type: 'fadeIn',
                    target: mergedCluster.pointCloud,
                    startOpacity: 0,
                    endOpacity: 1,
                    startTime: performance.now(),
                    duration: 500,
                    onComplete: () => {
                        mergedCluster.pointCloud.material.opacity = 1;
                        this.visibleClusters.add(event.path);
                        console.log(`  Leaf promotion complete: ${event.path} now visible`);
                    }
                });
            }, this.RISE_DURATION * 0.7);
        });
    }
    
    /**
     * Type C: Parent Merge - multiple clusters rise and converge
     * 
     * What this means:
     * - A "parent" merged folder has both ba_output AND child merged folders as inputs
     * - Example: C_1/merged = C_1/ba_output + C_1_1/merged + C_1_2/merged
     * - All input clusters rise up and converge to form the parent merged result
     * 
     * Camera: First shows all input clusters, then zooms to follow them converging
     */
    animateParentMerge(event) {
        console.log(`  Parent Merge: ${event.path}`);
        console.log(`  Inputs: ${event.inputs.join(', ')}`);
        
        const mergedCluster = this.clusters.get(event.path);
        if (!mergedCluster || !mergedCluster.pointCloud) {
            console.warn(`  Missing merged cluster: ${event.path}`);
            return;
        }
        
        const mergedPos = this.clusterPositions.get(event.path);
        const targetPos = mergedPos ? new THREE.Vector3(mergedPos.x, mergedPos.y, 0) : new THREE.Vector3(0, 0, 0);
        
        console.log(`  Target position: (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`);
        
        // Collect positions of all visible inputs
        const inputPositions = [];
        for (const inputPath of event.inputs) {
            const inputCluster = this.clusters.get(inputPath);
            if (inputCluster && inputCluster.pointCloud && inputCluster.pointCloud.visible) {
                inputPositions.push(inputCluster.group.position.clone());
            }
        }
        
        // First, zoom out to show all inputs that will merge
        this.focusOnMultiple(inputPositions.length > 0 ? inputPositions : [targetPos]).then(() => {
            // Brief pause to let user see all the inputs
            setTimeout(() => {
                // Animate all inputs rising and converging
                let animatedCount = 0;
                for (const inputPath of event.inputs) {
                    const inputCluster = this.clusters.get(inputPath);
                    if (!inputCluster || !inputCluster.pointCloud) {
                        console.warn(`  Input not found: ${inputPath}`);
                        continue;
                    }
                    
                    // Only animate visible clusters
                    if (!inputCluster.pointCloud.visible) {
                        console.log(`  Input not visible (skipping animation): ${inputPath}`);
                        continue;
                    }
                    
                    animatedCount++;
                    const startPos = inputCluster.group.position.clone();
                    
                    this.activeAnimations.push({
                        type: 'mergeRise',
                        cluster: inputCluster,
                        startPos: startPos.clone(),
                        endPos: targetPos.clone(),
                        startTime: performance.now(),
                        duration: this.MERGE_DURATION,
                        onComplete: () => {
                            inputCluster.pointCloud.visible = false;
                            // Reset position
                            const origPos = this.clusterPositions.get(inputPath);
                            if (origPos) {
                                inputCluster.group.position.set(origPos.x, origPos.y, 0);
                            }
                            this.visibleClusters.delete(inputPath);
                        }
                    });
                }
                
                console.log(`  Animating ${animatedCount} input clusters`);
                
                // Camera follows to the merge point
                this.activeAnimations.push({
                    type: 'cameraFollow',
                    startPos: this.camera.position.clone(),
                    endPos: new THREE.Vector3(targetPos.x, targetPos.y, this.FOCUS_DISTANCE),
                    startTarget: this.orbitControls.target.clone(),
                    endTarget: targetPos.clone(),
                    startTime: performance.now(),
                    duration: this.MERGE_DURATION
                });
                
                // Show merged result
                setTimeout(() => {
                    mergedCluster.group.position.copy(targetPos);
                    mergedCluster.pointCloud.visible = true;
                    mergedCluster.pointCloud.material.transparent = true;
                    mergedCluster.pointCloud.material.opacity = 0;
                    
                    this.activeAnimations.push({
                        type: 'fadeIn',
                        target: mergedCluster.pointCloud,
                        startOpacity: 0,
                        endOpacity: 1,
                        startTime: performance.now(),
                        duration: 600,
                        onComplete: () => {
                            mergedCluster.pointCloud.material.opacity = 1;
                            this.visibleClusters.add(event.path);
                            console.log(`  Parent merge complete: ${event.path} now visible`);
                        }
                    });
                }, this.MERGE_DURATION * 0.7);
            }, 200); // Brief pause after zooming out
        });
    }
    
    /**
     * Type D: Final Merge - grand finale
     * 
     * What this means:
     * - The root 'merged' folder combines ALL top-level clusters
     * - Inputs: ba_output + C_1/merged + C_2/merged + C_3/merged + C_4/merged
     * - All 5 remaining clusters converge to form the complete Gerrard Hall
     * - Camera first shows all 5 clusters, then follows them converging,
     *   finally zooms in close and does a 360° rotation
     */
    animateFinalMerge(event) {
        console.log(`  FINAL MERGE: ${event.path}`);
        console.log(`  Inputs: ${event.inputs.join(', ')}`);
        
        const mergedCluster = this.clusters.get('merged');
        if (!mergedCluster || !mergedCluster.pointCloud) {
            console.warn(`  Missing final merged cluster!`);
            return;
        }
        
        const mergedPos = this.clusterPositions.get('merged');
        const targetPos = mergedPos ? new THREE.Vector3(mergedPos.x, mergedPos.y, 0) : new THREE.Vector3(0, 0, 0);
        
        console.log(`  Target position: (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`);
        
        // Collect positions of all visible inputs
        const inputPositions = [];
        for (const inputPath of event.inputs) {
            const inputCluster = this.clusters.get(inputPath);
            if (inputCluster && inputCluster.pointCloud && inputCluster.pointCloud.visible) {
                inputPositions.push(inputCluster.group.position.clone());
            }
        }
        
        // First, zoom out to show all 5 inputs
        this.focusOnMultiple(inputPositions.length > 0 ? inputPositions : [targetPos]).then(() => {
            // Brief pause to let user see all the inputs
            setTimeout(() => {
                // Animate all 5 inputs converging with stagger
                let animatedCount = 0;
                event.inputs.forEach((inputPath, i) => {
                    const inputCluster = this.clusters.get(inputPath);
                    if (!inputCluster || !inputCluster.pointCloud) {
                        console.warn(`  Input not found: ${inputPath}`);
                        return;
                    }
                    if (!inputCluster.pointCloud.visible) {
                        console.log(`  Input not visible: ${inputPath}`);
                        return;
                    }
                    
                    animatedCount++;
                    const startPos = inputCluster.group.position.clone();
                    
                    setTimeout(() => {
                        this.activeAnimations.push({
                            type: 'mergeRise',
                            cluster: inputCluster,
                            startPos: startPos.clone(),
                            endPos: targetPos.clone(),
                            startTime: performance.now(),
                            duration: this.FINAL_MERGE_DURATION,
                            onComplete: () => {
                                inputCluster.pointCloud.visible = false;
                                const origPos = this.clusterPositions.get(inputPath);
                                if (origPos) {
                                    inputCluster.group.position.set(origPos.x, origPos.y, 0);
                                }
                                this.visibleClusters.delete(inputPath);
                            }
                        });
                    }, i * 150);
                });
                
                console.log(`  Animating ${animatedCount} input clusters for final merge`);
                
                // Camera follows to the merge point
                this.activeAnimations.push({
                    type: 'cameraFollow',
                    startPos: this.camera.position.clone(),
                    endPos: new THREE.Vector3(targetPos.x, targetPos.y, this.FOCUS_DISTANCE * 1.5), // Slightly further for 5 clusters
                    startTarget: this.orbitControls.target.clone(),
                    endTarget: targetPos.clone(),
                    startTime: performance.now(),
                    duration: this.FINAL_MERGE_DURATION
                });
                
                // Show final merged building
                setTimeout(() => {
                    mergedCluster.group.position.copy(targetPos);
                    mergedCluster.pointCloud.visible = true;
                    mergedCluster.pointCloud.material.transparent = true;
                    mergedCluster.pointCloud.material.opacity = 0;
                    
                    this.activeAnimations.push({
                        type: 'fadeIn',
                        target: mergedCluster.pointCloud,
                        startOpacity: 0,
                        endOpacity: 1,
                        startTime: performance.now(),
                        duration: 1000,
                        onComplete: () => {
                            mergedCluster.pointCloud.material.opacity = 1;
                            this.visibleClusters.add('merged');
                            console.log(`  FINAL MERGE COMPLETE: Gerrard Hall fully reconstructed!`);
                            
                            // Zoom in close and rotate
                            this.zoomAndRotate(targetPos);
                        }
                    });
                }, this.FINAL_MERGE_DURATION * 0.8);
            }, 500); // Longer pause before final merge animation
        });
    }
    
    zoomAndRotate(targetPos) {
        if (!this.camera || !this.orbitControls) return;
        
        const startPos = this.camera.position.clone();
        const startTarget = this.orbitControls.target.clone();
        
        // Zoom to about 15% of original distance for a nice close-up (80% of screen)
        const zoomDistance = this.cameraDistance * 0.15;
        const endPos = new THREE.Vector3(targetPos.x, targetPos.y, zoomDistance);
        const endTarget = targetPos.clone();
        
        console.log(`  Camera zooming from Z=${startPos.z.toFixed(0)} to Z=${zoomDistance.toFixed(0)}`);
        
        this.activeAnimations.push({
            type: 'cameraZoom',
            startPos: startPos,
            endPos: endPos,
            startTarget: startTarget,
            endTarget: endTarget,
            startTime: performance.now(),
            duration: 1500,
            onComplete: () => {
                console.log(`  Starting 360° rotation around Gerrard Hall`);
                this.rotate360(targetPos, zoomDistance);
            }
        });
    }
    
    rotate360(center, distance) {
        this.activeAnimations.push({
            type: 'rotate360',
            centerX: center.x,
            centerY: center.y,
            distance: distance,
            startAngle: 0,
            endAngle: Math.PI * 2,
            startTime: performance.now(),
            duration: 5000
        });
    }
    
    /**
     * Update animations
     */
    update(dt) {
        const now = performance.now();
        
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            const elapsed = now - anim.startTime;
            const t = Math.min(elapsed / anim.duration, 1);
            const eased = this.easeInOutCubic(t);
            
            switch (anim.type) {
                case 'fadeIn':
                    if (anim.target && anim.target.material) {
                        anim.target.material.opacity = anim.startOpacity + (anim.endOpacity - anim.startOpacity) * eased;
                    }
                    break;
                    
                case 'rise':
                case 'mergeRise':
                    if (anim.cluster && anim.cluster.group) {
                        anim.cluster.group.position.lerpVectors(anim.startPos, anim.endPos, eased);
                        
                        // Fade out in last 30%
                        if (t > 0.7 && anim.cluster.pointCloud) {
                            const fadeT = (t - 0.7) / 0.3;
                            anim.cluster.pointCloud.material.transparent = true;
                            anim.cluster.pointCloud.material.opacity = 1 - fadeT;
                        }
                    }
                    break;
                    
                case 'cameraZoom':
                case 'cameraFocus':
                case 'cameraFollow':
                    if (this.camera && this.orbitControls) {
                        this.camera.position.lerpVectors(anim.startPos, anim.endPos, eased);
                        this.orbitControls.target.lerpVectors(anim.startTarget, anim.endTarget, eased);
                        this.orbitControls.update();
                    }
                    break;
                    
                case 'rotate360':
                    if (this.camera && this.orbitControls) {
                        const angle = anim.startAngle + (anim.endAngle - anim.startAngle) * eased;
                        const x = anim.centerX + Math.sin(angle) * anim.distance;
                        const z = Math.cos(angle) * anim.distance;
                        
                        this.camera.position.set(x, anim.centerY, z);
                        this.orbitControls.target.set(anim.centerX, anim.centerY, 0);
                        this.orbitControls.update();
                    }
                    break;
            }
            
            if (t >= 1) {
                if (anim.onComplete) anim.onComplete();
                this.activeAnimations.splice(i, 1);
            }
        }
    }
    
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
}
