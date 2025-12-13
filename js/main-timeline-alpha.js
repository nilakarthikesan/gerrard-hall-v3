import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DataLoader } from './data-loader.js?v=413';
import { EventTimelineEngine } from './event-timeline-engine.js?v=3';
import { AlphaAnimationEngine } from './animation-engine-alpha.js?v=3';

/**
 * Timeline Alpha View Application
 * 
 * Shows the 38-event reconstruction with ALPHA BLENDING:
 * - Points interpolate between keyframes (constituent → merged)
 * - Motion trails via alpha blending (like Frank's sample)
 * - Smooth easing for "flock" effect
 * 
 * Key Innovation:
 * Instead of just fading clusters in/out, this view animates
 * INDIVIDUAL POINTS from their source positions to merged positions.
 */
class TimelineAlphaApp {
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
        this.camera.position.set(0, 0, 200);
        
        // Renderer with alpha blending support
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true  // Important for motion trails
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        // For alpha trail effect, we'll use a fade plane
        this.setupAlphaTrailEffect();
        
        this.container.appendChild(this.renderer.domElement);
        
        // Controls
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.autoRotate = false;
        
        // Minimal lighting (we're using additive blending)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        // World Group
        this.worldGroup = new THREE.Group();
        this.scene.add(this.worldGroup);

        // Handle Resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }
    
    /**
     * Set up the alpha trail effect
     * 
     * We create a fullscreen quad that fades the previous frame,
     * creating the motion blur trail effect from Frank's sample
     */
    setupAlphaTrailEffect() {
        // Create a render target to store the previous frame
        this.trailIntensity = 0.92;  // How much of previous frame to keep (0.92 = nice trails)
        
        // We'll implement this with a simple technique:
        // Render to texture, then composite with fade
        // For now, we'll use the simpler approach of just the additive blending
        // which creates a similar glowing effect
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
            blendState: document.getElementById('blend-state'),
            blendProgress: document.getElementById('blend-progress')
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
                    // Keep normal blending for proper RGB colors on white background
                    cluster.pointCloud.material.blending = THREE.NormalBlending;
                    cluster.pointCloud.material.depthWrite = true;
                }
            }

            // Event Timeline Engine
            this.eventEngine = new EventTimelineEngine(clusters);
            this.events = this.eventEngine.buildEvents();
            this.eventEngine.printEvents();
            
            // Alpha Animation Engine
            this.animationEngine = new AlphaAnimationEngine(clusters, this.eventEngine);
            this.animationEngine.initializePositions();
            
            // Create the morph cloud for interpolation effects
            this.animationEngine.createMorphCloud(this.scene);
            
            // Set up blend info callback
            this.animationEngine.onBlendUpdate = (state, progress) => {
                if (this.ui.blendState) this.ui.blendState.textContent = state;
                if (this.ui.blendProgress) this.ui.blendProgress.textContent = `${progress}%`;
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
        this.cameraDistance = 300;
        this.camera.position.set(0, 0, this.cameraDistance);
        this.camera.lookAt(0, 0, 0);
        this.orbitControls.target.set(0, 0, 0);
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
                        this.ui.phaseIndicator.textContent = 'Phase 1: ba_output';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-1';
                        break;
                    case 'leaf_promotion':
                        this.ui.phaseIndicator.textContent = 'Phase 2: Leaf Promo';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-2';
                        break;
                    case 'parent_merge':
                        this.ui.phaseIndicator.textContent = 'Phase 3: Parent Merge';
                        this.ui.phaseIndicator.className = 'phase-indicator phase-3';
                        break;
                    case 'final_merge':
                        this.ui.phaseIndicator.textContent = 'Phase 4: FINAL';
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
        
        // Include morph cloud points
        if (this.animationEngine?.morphCloud?.visible) {
            visiblePoints += this.animationEngine.morphPointCount || 0;
        }
        
        this.ui.stats.textContent = `Points: ${visiblePoints.toLocaleString()} | Clusters: ${visibleClusters}`;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const time = performance.now() / 1000;
        const dt = 0.016;

        // Auto-play logic
        if (this.isPlaying) {
            if (!this.lastStepTime) this.lastStepTime = time;
            
            // Pace: faster for fade_in, slower for morphs
            const stepDelay = this.currentEventIndex < 19 ? 1.0 : 2.5;
            
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
const app = new TimelineAlphaApp();
window.app = app;
app.start();

