import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DataLoader } from './data-loader.js?v=414';
import { EventTimelineEngine } from './event-timeline-engine.js?v=3';
import { CentroidAnimationEngine } from './animation-engine-centroid.js?v=3001';

/**
 * Timeline Centroid View Application
 * 
 * Shows the 38-event reconstruction with GEOMETRIC POSITIONING:
 * - Clusters appear at their actual 3D centroid positions (exploded outward)
 * - When clusters merge, they IMPLODE toward their combined centroid
 * - Final result: complete building assembled at center
 * 
 * Key Insight:
 * The folder structure tells us WHAT merges, but the centroid positions
 * tell us WHERE things are in 3D space. This view shows the spatial
 * relationships of the reconstruction.
 */
class TimelineCentroidApp {
    constructor() {
        this.initThree();
        this.initUI();
    }

    initThree() {
        this.container = document.getElementById('canvas-container');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);  // White background
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 300);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        this.container.appendChild(this.renderer.domElement);
        
        // Controls
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.autoRotate = false;
        
        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        // World Group
        this.worldGroup = new THREE.Group();
        this.scene.add(this.worldGroup);
        
        // Add subtle grid for spatial reference
        this.addReferenceGrid();

        // Handle Resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }
    
    /**
     * Add a subtle grid to help visualize the layout
     */
    addReferenceGrid() {
        // Grid to cover the layout
        const gridHelper = new THREE.GridHelper(400, 20, 0xdddddd, 0xeeeeee);
        gridHelper.position.y = -120;  // Below the deepest clusters
        gridHelper.position.x = 30;    // Centered on layout
        gridHelper.material.transparent = true;
        gridHelper.material.opacity = 0.3;
        this.scene.add(gridHelper);
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
            phaseIndicator: document.getElementById('phase-indicator'),
            infoMode: document.getElementById('info-mode'),
            infoAction: document.getElementById('info-action')
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
                if (cluster.pointCloud) {
                    cluster.pointCloud.visible = false;
                    cluster.pointCloud.material.size = 2.5;  // Larger points for visibility
                }
            }

            // Event Timeline Engine
            this.eventEngine = new EventTimelineEngine(clusters);
            this.events = this.eventEngine.buildEvents();
            this.eventEngine.printEvents();
            
            // Centroid Animation Engine
            this.animationEngine = new CentroidAnimationEngine(clusters, this.eventEngine);
            this.animationEngine.initializePositions();
            
            // Set up info callback
            this.animationEngine.onInfoUpdate = (mode, action) => {
                if (this.ui.infoMode) this.ui.infoMode.textContent = mode;
                if (this.ui.infoAction) this.ui.infoAction.textContent = action;
            };
            
            // Fit camera
            this.fitCamera();
            this.animationEngine.setCamera(this.camera, this.orbitControls, this.cameraDistance);

            // Initial state
            this.currentEventIndex = -1;
            this.updateUI();

            this.ui.loading.style.display = 'none';
            
            // Start render loop
            this.animate();
            
        } catch (err) {
            console.error("App Start Error:", err);
            this.ui.loadingText.innerHTML = `<span style="color: #ff6666">Error: ${err.message}</span>`;
        }
    }

    fitCamera() {
        // Distance to see the full layout (V1 - hard-coded flat layout)
        this.cameraDistance = 350;
        this.camera.position.set(30, 0, this.cameraDistance);
        this.camera.lookAt(30, 0, 0);
        this.orbitControls.target.set(30, 0, 0);
        this.orbitControls.update();
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
            for (const cluster of this.dataLoader.clusters.values()) {
                if (cluster.pointCloud) cluster.pointCloud.visible = false;
            }
        }
        
        this.updateUI();
    }

    reset() {
        this.isPlaying = false;
        this.ui.playBtn.textContent = '▶ Play';
        this.jumpTo(-1);
        this.fitCamera();
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        this.ui.playBtn.textContent = this.isPlaying ? '⏸ Pause' : '▶ Play';
        
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
            this.ui.eventLabel.textContent = 'Ready - Press Next or Play';
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
                        this.ui.phaseIndicator.textContent = 'Phase 1: Appear';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-1';
                        break;
                    case 'leaf_promotion':
                        this.ui.phaseIndicator.textContent = 'Transitioning...';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-2';
                        break;
                    case 'parent_merge':
                        this.ui.phaseIndicator.textContent = 'Phase 3: Implode';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-3';
                        break;
                    case 'final_merge':
                        this.ui.phaseIndicator.textContent = 'Phase 4: ASSEMBLE';
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
        this.ui.stats.textContent = `Points: ${visiblePoints.toLocaleString()} | Clusters: ${visibleClusters}`;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const time = performance.now() / 1000;
        const dt = 0.016;

        // Auto-play logic - wait for animations to complete before stepping
        if (this.isPlaying) {
            if (!this.lastStepTime) this.lastStepTime = time;
            
            // Check if animation engine is still animating
            const isAnimating = this.animationEngine && 
                                this.animationEngine.activeAnimations && 
                                this.animationEngine.activeAnimations.length > 0;
            
            // Pace: delays MUST be longer than animation durations + viewing time
            let stepDelay;
            if (this.currentEventIndex < 19) {
                stepDelay = 2.5;  // Phase 1: 1.5s fade + 1s viewing
            } else if (this.currentEventIndex < 30) {
                stepDelay = 0.1;  // Phase 2: INSTANT (no animation)
            } else if (this.currentEventIndex < 37) {
                stepDelay = 5.0;  // Phase 3: 3s implode + 2s viewing
            } else {
                stepDelay = 8.0;  // Phase 4: 5s final + 3s viewing
            }
            
            // Only step if not animating AND enough time has passed
            if (!isAnimating && time - this.lastStepTime > stepDelay) {
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
const app = new TimelineCentroidApp();
window.app = app;
app.start();

