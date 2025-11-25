import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DataLoader } from './data-loader.js';
import { LayoutEngine } from './layout-engine.js';
import { InteractionEngine } from './interaction-engine.js';
import { AnimationEngine } from './animation-engine.js';
import { CameraEngine } from './camera-engine.js';

class App {
    constructor() {
        this.initThree();
        this.initEngines();
        this.initUI();
    }

    initThree() {
        this.container = document.getElementById('canvas-container');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff); // White background
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 100); // Start further back
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.container.appendChild(this.renderer.domElement);
        
        // Controls - COMPLETELY DISABLE AUTO ROTATION
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.autoRotate = false; 
        this.orbitControls.autoRotateSpeed = 0;
        this.orbitControls.enableRotate = true; // Allow manual rotation
        this.orbitControls.enablePan = true;
        this.orbitControls.enableZoom = true;
        
        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
        dirLight.position.set(10, 10, 10);
        this.scene.add(dirLight);

        // Global Group to hold all clusters
        this.worldGroup = new THREE.Group();
        // Remove the rotation - let's see the data as-is first
        // this.worldGroup.rotation.z = Math.PI; 
        this.scene.add(this.worldGroup);

        // Handle Resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initEngines() {
        this.dataLoader = new DataLoader();
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
            track: document.getElementById('timeline-track')
        };

        this.ui.prevBtn.addEventListener('click', () => this.step(-1));
        this.ui.nextBtn.addEventListener('click', () => this.step(1));
        this.ui.resetBtn.addEventListener('click', () => this.reset());
        this.ui.playBtn.addEventListener('click', () => this.togglePlay());
        
        this.ui.track.addEventListener('click', (e) => {
            if (!this.animationEngine) return;
            const rect = this.ui.track.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const index = Math.floor(pct * this.animationEngine.mergeEvents.length);
            this.jumpTo(index);
        });
    }

    async start() {
        try {
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
            }

            // 1. Layout Engine - computes positions
            this.layoutEngine = new LayoutEngine(clusters);
            this.layoutEngine.computeLayout();

            // 2. Fit camera to the layout bounds
            this.fitCameraToLayout();

            // 3. Animation Timeline - ONLY includes merge tree nodes (no orphans)
            this.animationEngine = new AnimationEngine(clusters, this.layoutEngine);
            this.events = this.animationEngine.initTimeline();
            this.currentEventIndex = 0;

            // 4. Interaction
            this.interactionEngine = new InteractionEngine(
                this.camera, 
                this.renderer.domElement, 
                clusters, 
                this.orbitControls
            );

            // 5. Camera Engine
            this.cameraEngine = new CameraEngine(this.camera, this.orbitControls);

            // Initial State: Show first event (first leaf cluster)
            if (this.events.length > 0) {
                this.animationEngine.applyEventInstant(0);
            }
            this.updateUI();

            this.ui.loading.style.display = 'none';
            
            // Start render loop
            this.animate();
            
        } catch (err) {
            console.error("App Start Error:", err);
            this.ui.loadingText.innerHTML = `<span style="color: #ff4444">Error starting app:<br>${err.message}</span>`;
        }
    }

    fitCameraToLayout() {
        if (!this.layoutEngine.bounds) {
            console.warn("No layout bounds available");
            return;
        }
        
        const b = this.layoutEngine.bounds;
        console.log("=== FITTING CAMERA ===");
        console.log(`Layout bounds: ${b.width.toFixed(1)} x ${b.height.toFixed(1)}`);
        
        // Calculate distance needed to fit the layout in view
        const fov = this.camera.fov;
        const aspect = window.innerWidth / window.innerHeight;
        
        // We need to fit both width and height
        // For vertical: dist = (height/2) / tan(fov/2)
        // For horizontal: dist = (width/2) / tan(hfov/2) where hfov = 2*atan(aspect*tan(fov/2))
        
        const vFovRad = THREE.MathUtils.degToRad(fov / 2);
        const hFovRad = Math.atan(aspect * Math.tan(vFovRad));
        
        const distForHeight = (b.height / 2) / Math.tan(vFovRad);
        const distForWidth = (b.width / 2) / Math.tan(hFovRad);
        
        // Use the larger distance to ensure everything fits
        let dist = Math.max(distForHeight, distForWidth);
        
        // NO padding - zoom in as close as possible
        // dist *= 1.0; // No multiplier
        
        // Very low minimum distance
        dist = Math.max(dist, 10);
        
        // Cap maximum distance to prevent being too far away
        dist = Math.min(dist, 80);
        
        console.log(`Camera distance: ${dist.toFixed(1)}`);
        
        // Position camera looking at center
        this.camera.position.set(0, 0, dist);
        this.camera.lookAt(0, 0, 0);
        
        // Set orbit controls target to center
        this.orbitControls.target.set(0, 0, 0);
        this.orbitControls.update();
        
        console.log(`Camera position: (0, 0, ${dist.toFixed(1)})`);
        console.log(`Looking at: (0, 0, 0)`);
    }

    step(direction) {
        if (direction > 0) {
            if (this.currentEventIndex < this.events.length - 1) {
                this.currentEventIndex++;
                this.animationEngine.playEvent(this.currentEventIndex, 1);
                this.checkEndSequence();
            }
        } else {
            if (this.currentEventIndex > 0) {
                this.animationEngine.playEvent(this.currentEventIndex, -1);
                this.currentEventIndex--;
            }
        }
        this.updateUI();
    }
    
    jumpTo(index) {
        if (index < 0) index = 0;
        if (index >= this.events.length) index = this.events.length - 1;
        this.currentEventIndex = index;
        this.animationEngine.applyEventInstant(index);
        this.updateUI();
    }

    reset() {
        this.isPlaying = false;
        this.ui.playBtn.textContent = 'Play Sequence';
        this.cameraEngine.stopFlythrough();
        this.jumpTo(0);
    }

    togglePlay() {
        this.isPlaying = !this.isPlaying;
        this.ui.playBtn.textContent = this.isPlaying ? 'Pause' : 'Play Sequence';
        
        if (this.isPlaying && this.currentEventIndex >= this.events.length - 1) {
            this.jumpTo(0);
        }
    }

    checkEndSequence() {
        if (this.currentEventIndex === this.events.length - 1) {
            // Reached end -> could trigger flythrough here
            // For now, just stop
            console.log("Reached final merge!");
        }
    }

    updateUI() {
        const count = this.events.length;
        if (count === 0) return;
        
        const progress = (this.currentEventIndex / (count - 1)) * 100;
        this.ui.progressBar.style.width = `${progress}%`;
        
        const event = this.events[this.currentEventIndex];
        const eventType = event.isLeaf ? 'Showing' : 'Merging into';
        this.ui.eventLabel.textContent = `Event ${this.currentEventIndex + 1}/${count}: ${eventType} ${event.path}`;
        
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

        // Auto Play logic
        if (this.isPlaying) {
            if (!this.lastStepTime) this.lastStepTime = time;
            if (time - this.lastStepTime > 1.5) {
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
        if (this.cameraEngine) this.cameraEngine.update(time);
        
        // Update orbit controls (for damping)
        this.orbitControls.update();
        
        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
const app = new App();
app.start();
