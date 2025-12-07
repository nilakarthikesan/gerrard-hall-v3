import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DataLoader } from './data-loader.js?v=400';
import { EventTimelineEngine } from './event-timeline-engine.js?v=1';
import { TimelineAnimationEngine } from './animation-engine-timeline.js?v=1';
import { InteractionEngine } from './interaction-engine.js?v=305';

/**
 * Timeline View Application
 * Shows all 38 events of the GTSfM reconstruction process
 * 
 * Events 1-19:  ba_output clusters appear (fade_in)
 * Events 20-30: Leaf promotions (ba_output → merged)
 * Events 31-37: Parent merges (children combine)
 * Event 38:     Final merge (complete Gerrard Hall)
 */
class TimelineApp {
    constructor() {
        this.initThree();
        this.initUI();
    }

    initThree() {
        this.container = document.getElementById('canvas-container');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 150);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
        
        // Controls
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.autoRotate = false;
        
        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
        dirLight.position.set(10, 20, 10);
        this.scene.add(dirLight);

        // World Group - contains all clusters
        this.worldGroup = new THREE.Group();
        this.scene.add(this.worldGroup);

        // Handle Resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initUI() {
        this.ui = {
            loading: document.getElementById('loading'),
            loadingText: document.querySelector('.loading-text'),
            eventLabel: document.getElementById('event-label'),
            progressBar: document.getElementById('timeline-progress'),
            stats: document.getElementById('stats-display'),
            prevBtn: document.getElementById('btn-prev'),
            nextBtn: document.getElementById('btn-next'),
            playBtn: document.getElementById('btn-play'),
            resetBtn: document.getElementById('btn-reset'),
            track: document.getElementById('timeline-track'),
            phaseIndicator: document.getElementById('phase-indicator')
        };

        this.ui.prevBtn.addEventListener('click', () => this.step(-1));
        this.ui.nextBtn.addEventListener('click', () => this.step(1));
        this.ui.resetBtn.addEventListener('click', () => this.reset());
        this.ui.playBtn.addEventListener('click', () => this.togglePlay());
        
        this.ui.track.addEventListener('click', (e) => {
            if (!this.events) return;
            const rect = this.ui.track.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const index = Math.floor(pct * this.events.length);
            this.jumpTo(index);
        });
    }

    async start() {
        try {
            this.dataLoader = new DataLoader();
            
            this.dataLoader.onProgress = (loaded, total) => {
                this.ui.loadingText.textContent = `Loading Clusters... ${loaded}/${total}`;
            };

            const clusters = await this.dataLoader.load();
            
            if (clusters.size === 0) {
                throw new Error("No clusters loaded. Check console/network.");
            }
        
            // Add all cluster groups to world
            for (const cluster of clusters.values()) {
                this.worldGroup.add(cluster.group);
                // Initially hide all
                if (cluster.pointCloud) {
                    cluster.pointCloud.visible = false;
                }
            }

            // 1. Event Timeline Engine - generates 38 events
            this.eventEngine = new EventTimelineEngine(clusters);
            this.events = this.eventEngine.buildEvents();
            this.eventEngine.printEvents();
            
            // 2. Animation Engine - handles 4 animation types
            this.animationEngine = new TimelineAnimationEngine(clusters, this.eventEngine);
            this.animationEngine.initializePositions();
            
            // 3. Fit camera
            this.fitCamera();
            this.animationEngine.setCamera(this.camera, this.orbitControls, this.cameraDistance);

            // 4. Interaction
            this.interactionEngine = new InteractionEngine(
                this.camera, 
                this.renderer.domElement, 
                clusters, 
                this.orbitControls
            );

            // Initial state - before any events
            this.currentEventIndex = -1;
            this.updateUI();

            this.ui.loading.style.display = 'none';
            
            // Start render loop
            this.animate();
            
        } catch (err) {
            console.error("App Start Error:", err);
            this.ui.loadingText.innerHTML = `<span style="color: #ff4444">Error starting app:<br>${err.message}</span>`;
        }
    }

    fitCamera() {
        // Calculate camera distance to see all clusters
        const fov = this.camera.fov;
        const aspect = window.innerWidth / window.innerHeight;
        
        // Estimate scene size based on number of levels
        const numLevels = 6; // Approximate max depth
        const levelSpacing = 30;
        const totalHeight = numLevels * levelSpacing;
        
        const vFovRad = THREE.MathUtils.degToRad(fov / 2);
        const distForHeight = (totalHeight / 2 + 50) / Math.tan(vFovRad);
        
        this.cameraDistance = Math.max(distForHeight, 120);
        
        this.camera.position.set(0, 0, this.cameraDistance);
        this.camera.lookAt(0, 0, 0);
        this.orbitControls.target.set(0, 0, 0);
        this.orbitControls.update();
        
        console.log(`Camera distance: ${this.cameraDistance}`);
    }

    step(direction) {
        const newIndex = this.currentEventIndex + direction;
        
        if (direction > 0 && newIndex < this.events.length) {
            this.currentEventIndex = newIndex;
            this.animationEngine.playEvent(this.currentEventIndex, 1);
        } else if (direction < 0 && newIndex >= -1) {
            this.currentEventIndex = newIndex;
            if (newIndex >= 0) {
                this.animationEngine.applyEventInstant(newIndex);
            } else {
                // Before first event - hide all
                for (const cluster of this.dataLoader.clusters.values()) {
                    if (cluster.pointCloud) cluster.pointCloud.visible = false;
                }
            }
        }
        
        this.updateUI();
    }
    
    jumpTo(index) {
        if (index < -1) index = -1;
        if (index >= this.events.length) index = this.events.length - 1;
        
        this.currentEventIndex = index;
        
        if (index >= 0) {
            this.animationEngine.applyEventInstant(index);
        } else {
            // Before first event
            for (const cluster of this.dataLoader.clusters.values()) {
                if (cluster.pointCloud) cluster.pointCloud.visible = false;
            }
        }
        
        this.updateUI();
    }

    reset() {
        this.isPlaying = false;
        this.ui.playBtn.textContent = 'Play Sequence';
        this.jumpTo(-1);
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        this.ui.playBtn.textContent = this.isPlaying ? 'Pause' : 'Play Sequence';
        
        if (this.isPlaying && this.currentEventIndex >= this.events.length - 1) {
            this.jumpTo(-1);
        }
    }

    updateUI() {
        const count = this.events.length;
        if (count === 0) return;
        
        // Progress bar
        const progress = ((this.currentEventIndex + 1) / count) * 100;
        this.ui.progressBar.style.width = `${Math.max(0, progress)}%`;
        
        // Event label
        if (this.currentEventIndex < 0) {
            this.ui.eventLabel.textContent = 'Ready to begin - Press Next or Play';
        } else {
            const event = this.events[this.currentEventIndex];
            this.ui.eventLabel.textContent = `Event ${event.number}/${count}: ${event.description}`;
        }
        
        // Phase indicator
        if (this.ui.phaseIndicator) {
            if (this.currentEventIndex < 0) {
                this.ui.phaseIndicator.textContent = 'Phase: Waiting';
                this.ui.phaseIndicator.className = 'phase-indicator';
            } else {
                const event = this.events[this.currentEventIndex];
                switch (event.type) {
                    case 'fade_in':
                        this.ui.phaseIndicator.textContent = 'Phase 1: ba_output appears';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-1';
                        break;
                    case 'leaf_promotion':
                        this.ui.phaseIndicator.textContent = 'Phase 2: Leaf promotion';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-2';
                        break;
                    case 'parent_merge':
                        this.ui.phaseIndicator.textContent = 'Phase 3: Parent merge';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-3';
                        break;
                    case 'final_merge':
                        this.ui.phaseIndicator.textContent = 'Phase 4: FINAL MERGE';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-4';
                        break;
                }
            }
        }
        
        // Stats
        let visiblePoints = 0;
        let visibleClusters = 0;
        for (const c of this.dataLoader.clusters.values()) {
            if (c.pointCloud && c.pointCloud.visible) {
                visibleClusters++;
                visiblePoints += c.pointsCount;
            }
        }
        this.ui.stats.textContent = `Clusters: ${visibleClusters} | Points: ${visiblePoints.toLocaleString()}`;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const time = performance.now() / 1000;
        const dt = 0.016;

        // Auto-play logic
        if (this.isPlaying) {
            if (!this.lastStepTime) this.lastStepTime = time;
            
            // Slower pace for timeline view to see each event clearly
            const stepDelay = this.currentEventIndex < 19 ? 0.8 : 1.5; // Faster for ba_output, slower for merges
            
            if (time - this.lastStepTime > stepDelay) {
                if (this.currentEventIndex < this.events.length - 1) {
                    this.step(1);
                    this.lastStepTime = time;
                } else {
                    this.togglePlay();
                }
            }
        } else {
            this.lastStepTime = 0;
        }

        if (this.animationEngine) this.animationEngine.update(dt);
        
        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
const app = new TimelineApp();
window.app = app;
app.start();

