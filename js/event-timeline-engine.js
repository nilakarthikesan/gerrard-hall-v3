/**
 * Event Timeline Engine
 * Generates and manages the 38-event timeline for GTSfM visualization
 * 
 * Events 1-19:  ba_output folders appear (random order)
 * Events 20-38: merged folders appear (dependency-respecting order)
 */
export class EventTimelineEngine {
    constructor(clusters) {
        this.clusters = clusters;
        this.events = [];
        this.baOutputPaths = [];
        this.mergedPaths = [];
        
        // Seeded random for reproducible order
        this.seed = 12345;
    }
    
    /**
     * Seeded random number generator for reproducible event order
     */
    seededRandom() {
        this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
        return this.seed / 0x7fffffff;
    }
    
    /**
     * Shuffle array using seeded random
     */
    shuffleArray(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(this.seededRandom() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    /**
     * Build the complete 38-event timeline
     */
    buildEvents() {
        console.log("=== EVENT TIMELINE ENGINE ===");
        
        // Separate clusters into ba_output and merged
        for (const [path, cluster] of this.clusters) {
            if (cluster.type === 'ba_output') {
                this.baOutputPaths.push(path);
            } else if (cluster.type === 'merged') {
                this.mergedPaths.push(path);
            }
        }
        
        console.log(`Found ${this.baOutputPaths.length} ba_output clusters`);
        console.log(`Found ${this.mergedPaths.length} merged clusters`);
        
        // Phase 1: Generate ba_output events (random order)
        this.generateBaOutputEvents();
        
        // Phase 2: Generate merged events (dependency order)
        this.generateMergedEvents();
        
        console.log(`Total events generated: ${this.events.length}`);
        
        return this.events;
    }
    
    /**
     * Phase 1: Generate events for ba_output clusters
     * Order is random (simulating async compute cluster)
     */
    generateBaOutputEvents() {
        const shuffled = this.shuffleArray(this.baOutputPaths);
        
        for (let i = 0; i < shuffled.length; i++) {
            const path = shuffled[i];
            this.events.push({
                number: i + 1,
                type: 'fade_in',
                path: path,
                inputs: [],
                description: `${path} appears`
            });
        }
        
        console.log(`Generated ${shuffled.length} ba_output events (1-${shuffled.length})`);
    }
    
    /**
     * Phase 2: Generate events for merged clusters
     * Order respects dependencies: children must complete before parents
     */
    generateMergedEvents() {
        // Build dependency map: which merged paths does each merged path depend on?
        const dependencies = new Map();
        
        for (const path of this.mergedPaths) {
            const cluster = this.clusters.get(path);
            const childMergedPaths = [];
            
            // Find child merged paths from childrenPaths
            for (const childPath of cluster.childrenPaths) {
                // If child is a merged folder, add it as dependency
                if (childPath.endsWith('/merged') || childPath === 'merged') {
                    childMergedPaths.push(childPath);
                } else {
                    // Check if there's a sibling merged folder
                    // e.g., for C_1/ba_output, look for C_1_1/merged, C_1_2/merged etc.
                    const childCluster = this.clusters.get(childPath);
                    if (childCluster) {
                        for (const cp of cluster.childrenPaths) {
                            if (cp.endsWith('/merged') && this.clusters.has(cp)) {
                                if (!childMergedPaths.includes(cp)) {
                                    childMergedPaths.push(cp);
                                }
                            }
                        }
                    }
                }
            }
            
            dependencies.set(path, childMergedPaths);
        }
        
        // Topological sort with random selection among ready nodes
        const completed = new Set();
        const mergedOrder = [];
        const startEventNumber = this.baOutputPaths.length + 1;
        
        while (completed.size < this.mergedPaths.length) {
            // Find all "ready" paths (all dependencies satisfied)
            const ready = this.mergedPaths.filter(path => {
                if (completed.has(path)) return false;
                const deps = dependencies.get(path) || [];
                return deps.every(d => completed.has(d) || !this.mergedPaths.includes(d));
            });
            
            if (ready.length === 0) {
                console.error("Dependency cycle detected or missing dependencies!");
                break;
            }
            
            // Randomly select from ready paths (seeded random)
            const idx = Math.floor(this.seededRandom() * ready.length);
            const chosen = ready[idx];
            
            completed.add(chosen);
            mergedOrder.push(chosen);
        }
        
        // Generate events for merged paths
        for (let i = 0; i < mergedOrder.length; i++) {
            const path = mergedOrder[i];
            const cluster = this.clusters.get(path);
            const eventNumber = startEventNumber + i;
            
            // Determine event type
            const type = this.determineMergeEventType(path, eventNumber, mergedOrder.length + startEventNumber - 1);
            
            // Get inputs (what clusters merge to create this)
            const inputs = cluster.childrenPaths || [];
            
            // Create description
            const description = this.createDescription(path, inputs, type);
            
            this.events.push({
                number: eventNumber,
                type: type,
                path: path,
                inputs: inputs,
                description: description
            });
        }
        
        console.log(`Generated ${mergedOrder.length} merged events (${startEventNumber}-${this.events.length})`);
    }
    
    /**
     * Determine the type of merge event
     */
    determineMergeEventType(path, eventNumber, lastEventNumber) {
        // Final merge is always the root 'merged' folder
        if (path === 'merged') {
            return 'final_merge';
        }
        
        const cluster = this.clusters.get(path);
        const inputs = cluster.childrenPaths || [];
        
        // Count how many inputs are merged folders (not ba_output)
        const mergedInputs = inputs.filter(p => p.endsWith('/merged') || p === 'merged');
        
        // If only ba_output as input (no child merged), it's a leaf promotion
        if (mergedInputs.length === 0) {
            return 'leaf_promotion';
        }
        
        // Otherwise it's a parent merge
        return 'parent_merge';
    }
    
    /**
     * Create human-readable description
     */
    createDescription(path, inputs, type) {
        const shortPath = path.replace(/\//g, '/');
        
        switch (type) {
            case 'fade_in':
                return `${shortPath} appears`;
                
            case 'leaf_promotion':
                return `${shortPath} = ba_output (leaf promotion)`;
                
            case 'parent_merge': {
                const inputNames = inputs.map(p => {
                    const parts = p.split('/');
                    return parts[parts.length - 1] === 'ba_output' ? 'ba_output' : parts.slice(-2).join('/');
                });
                return `${shortPath} = ${inputNames.join(' + ')}`;
            }
                
            case 'final_merge':
                return `FINAL: merged = ba_output + C_1 + C_2 + C_3 + C_4`;
                
            default:
                return path;
        }
    }
    
    /**
     * Get event by index (0-based)
     */
    getEvent(index) {
        return this.events[index];
    }
    
    /**
     * Get event by number (1-based)
     */
    getEventByNumber(number) {
        return this.events[number - 1];
    }
    
    /**
     * Get total number of events
     */
    getEventCount() {
        return this.events.length;
    }
    
    /**
     * Get all events of a specific type
     */
    getEventsByType(type) {
        return this.events.filter(e => e.type === type);
    }
    
    /**
     * Get the cluster path that should be visible after event N
     * Returns array of visible cluster paths
     */
    getVisibleClustersAfterEvent(eventIndex) {
        const visible = new Set();
        const hidden = new Set();
        
        for (let i = 0; i <= eventIndex; i++) {
            const event = this.events[i];
            
            switch (event.type) {
                case 'fade_in':
                    // ba_output becomes visible
                    visible.add(event.path);
                    break;
                    
                case 'leaf_promotion':
                    // ba_output hidden, merged visible
                    for (const input of event.inputs) {
                        if (input.endsWith('ba_output') || input === 'ba_output') {
                            visible.delete(input);
                            hidden.add(input);
                        }
                    }
                    visible.add(event.path);
                    break;
                    
                case 'parent_merge':
                case 'final_merge':
                    // All inputs hidden, result visible
                    for (const input of event.inputs) {
                        visible.delete(input);
                        hidden.add(input);
                    }
                    visible.add(event.path);
                    break;
            }
        }
        
        return Array.from(visible);
    }
    
    /**
     * Debug: Print all events
     */
    printEvents() {
        console.log("\n=== ALL EVENTS ===");
        for (const event of this.events) {
            console.log(`Event ${event.number} [${event.type}]: ${event.description}`);
        }
    }
}

