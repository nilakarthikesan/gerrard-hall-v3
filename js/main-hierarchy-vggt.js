import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VGGTDataLoader } from './data-loader-vggt.js?v=2';
import { SquarenessLayoutEngine } from './layout-engine-squareness.js?v=2';
import { InteractionEngine } from './interaction-engine.js?v=305';
import { SquarenessAnimationEngine } from './animation-engine-squareness.js?v=2';
import { CameraEngine } from './camera-engine.js?v=305';

class VGGTHierarchyApp {
    constructor() {
        this.initThree();
        this.initEngines();
        this.initUI();
    }

    initThree() {
        this.container = document.getElementById('canvas-container');
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xffffff);
        
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 0, 200);
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);
        
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.autoRotate = false;
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
        dirLight.position.set(10, 10, 10);
        this.scene.add(dirLight);

        this.worldGroup = new THREE.Group();
        this.scene.add(this.worldGroup);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initEngines() {
        this.dataLoader = new VGGTDataLoader();
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
                this.ui.loadingText.textContent = `Loading VGGT Clusters... ${loaded}/${total}`;
            };

            const clusters = await this.dataLoader.load();
            
            if (clusters.size === 0) {
                throw new Error("No clusters loaded. Check console/network.");
            }
        
            // Add all cluster groups to world
            for (const cluster of clusters.values()) {
                this.worldGroup.add(cluster.group);
            }

            // 1. Squareness Layout Engine
            this.layoutEngine = new SquarenessLayoutEngine(clusters);
            this.layoutEngine.computeLayout();

            // 2. Fit camera to layout
            this.fitCameraToLayout();

            // 3. Animation Timeline
            this.animationEngine = new SquarenessAnimationEngine(clusters, this.layoutEngine);
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

            // Initial State
            if (this.events.length > 0) {
                this.animationEngine.applyEventInstant(0);
            }
            this.updateUI();

            this.ui.loading.style.display = 'none';
            
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
        const fov = this.camera.fov;
        const aspect = window.innerWidth / window.innerHeight;
        
        const vFovRad = THREE.MathUtils.degToRad(fov / 2);
        const hFovRad = Math.atan(aspect * Math.tan(vFovRad));
        
        const distForHeight = (b.height / 2) / Math.tan(vFovRad);
        const distForWidth = (b.width / 2) / Math.tan(hFovRad);
        
        let dist = Math.max(distForHeight, distForWidth);
        
        // Show the full layout with some margin
        dist *= 1.1;
        
        dist = Math.max(dist, 8);
        
        const centerY = (b.maxY + b.minY) / 2;
        const centerX = (b.maxX + b.minX) / 2;
        
        console.log(`=== VGGT CAMERA FIT ===`);
        console.log(`Layout bounds: ${b.width.toFixed(1)} x ${b.height.toFixed(1)}`);
        console.log(`Center: (${centerX.toFixed(1)}, ${centerY.toFixed(1)})`);
        console.log(`Camera distance: ${dist.toFixed(1)}`);
        
        this.camera.position.set(centerX, centerY, dist);
        this.camera.lookAt(centerX, centerY, 0);
        this.orbitControls.target.set(centerX, centerY, 0);
        this.orbitControls.update();
    }

    step(direction) {
        if (direction > 0) {
            if (this.currentEventIndex < this.events.length - 1) {
                this.currentEventIndex++;
                this.animationEngine.playEvent(this.currentEventIndex, 1);
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

    updateUI() {
        const count = this.events.length;
        if (count === 0) return;
        
        const progress = (this.currentEventIndex / (count - 1)) * 100;
        this.ui.progressBar.style.width = `${progress}%`;
        
        const event = this.events[this.currentEventIndex];
        const eventType = event.isLeaf ? 'VGGT' : 'Merge';
        this.ui.eventLabel.textContent = `Event ${this.currentEventIndex + 1}/${count}: ${eventType} — ${event.path}`;
        
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

        if (this.isPlaying) {
            if (!this.lastStepTime) this.lastStepTime = time;
            if (time - this.lastStepTime > 1.2) {
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
        
        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Start App
const app = new VGGTHierarchyApp();
window.app = app;
app.start();
