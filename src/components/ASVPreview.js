// ASVPreview.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export default class ASVPreview {
    constructor(container) {
      this.container = container;
      this.scene = new THREE.Scene();
      this.scene.background = null;
  
      this.setupCamera();
      this.setupRenderer();
      this.setupLights();
      this.createWater();
      this.createBoat();
      this.setupControls();
      this.setupResizeHandler();
      this.animate();
    }
  
    setupCamera() {
      this.camera = new THREE.PerspectiveCamera(
        75,
        this.container.clientWidth / this.container.clientHeight,
        0.1,
        1000
      );
      this.camera.position.set(0, 2, 5);
    }
  
    setupRenderer() {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.setClearColor(0x000000, 0); // Set clear color to transparent (0 for alpha)
      this.container.appendChild(this.renderer.domElement);
    }
  
    setupLights() {
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      this.scene.add(ambientLight);
  
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(5, 5, 5);
      directionalLight.castShadow = true;
      this.scene.add(directionalLight);
    }
  
    createWater() {
      const waterGeometry = new THREE.PlaneGeometry(10, 10);
      const waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x0077be,
        transparent: true,
        opacity: 0.6,
        metalness: 0.1,
        roughness: 0.2,
      });
      this.water = new THREE.Mesh(waterGeometry, waterMaterial);
      this.water.rotation.x = -Math.PI / 2;
      this.water.receiveShadow = true;
      this.scene.add(this.water);
    }
  
    createBoat() {
      const boatGeometry = new THREE.BoxGeometry(2, 0.5, 1);
      const boatMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
      this.boat = new THREE.Mesh(boatGeometry, boatMaterial);
      this.boat.position.y = 0.25;
      this.boat.castShadow = true;
      this.scene.add(this.boat);
    }
  
    setupControls() {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.minDistance = 3;
      this.controls.maxDistance = 10;
    }
  
    setupResizeHandler() {
      window.addEventListener('resize', this.handleResize.bind(this));
    }
  
    handleResize() {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
  
    animate() {
      console.log("Animating...");
      requestAnimationFrame(this.animate.bind(this));
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }
  
    dispose() {
      window.removeEventListener('resize', this.handleResize.bind(this));
      this.scene.dispose();
      this.renderer.dispose();
      this.container.removeChild(this.renderer.domElement);
    }
  }