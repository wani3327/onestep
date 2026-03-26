interface Machine {
  name: string;
  width: number;
  height: number;
  ports: { x: number; y: number; type: string }[];
}

interface PlacedMachine {
  machine: Machine;
  x: number;
  y: number;
  rotation: number;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameraX: number = 0;
  private cameraY: number = 0;
  private zoom: number = 1;
  private gridSize: number = 50;

  private machines: Machine[] = [];
  private placedMachines: PlacedMachine[] = [];
  private heldMachines: Machine[] = [];
  private heldRotation: number = 0;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private isPlacing: boolean = false;
  private paletteWidth: number = 200;
  private lastPlacedX: number = -1;
  private lastPlacedY: number = -1;
  private isDestroying: boolean = false;
  private lastDestroyedX: number = -1;
  private lastDestroyedY: number = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.loadMachines();
    this.setupEventListeners();
  }

  private async loadMachines() {
    try {
      const response = await fetch('data.json');
      this.machines = await response.json();
    } catch (error) {
      console.error('Failed to load machines:', error);
      // Fallback data
      this.machines = [
        {
          name: "분쇄기",
          width: 3,
          height: 3,
          ports: [
            { x: 0, y: 0, type: "input" },
            { x: 1, y: 0, type: "input" },
            { x: 2, y: 0, type: "input" },
            { x: 0, y: 2, type: "output" },
            { x: 1, y: 2, type: "output" },
            { x: 2, y: 2, type: "output" }
          ]
        },
        {
          name: "재배기",
          width: 5,
          height: 5,
          ports: [
            { x: 0, y: 0, type: "input" },
            { x: 1, y: 0, type: "input" },
            { x: 2, y: 0, type: "input" },
            { x: 0, y: 2, type: "output" },
            { x: 1, y: 2, type: "output" },
            { x: 2, y: 2, type: "output" }
          ]
        }
      ];
    }
  }

  private setupEventListeners() {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x > this.canvas.width - this.paletteWidth) {
        this.handlePaletteClick(y);
      } else {
        if (e.button === 0 && this.heldMachines.length > 0) { // left click
          this.placeMachine(x, y);
          this.isPlacing = true;
        } else if (e.button === 2) { // right click
          this.removeMachine(x, y);
          this.isDestroying = true;
        }
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;

      if (this.isPlacing && this.heldMachines.length > 0) {
        this.placeMachine(this.mouseX, this.mouseY);
      } else if (this.isDestroying) {
        this.removeMachine(this.mouseX, this.mouseY);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPlacing = false;
      this.lastPlacedX = -1;
      this.lastPlacedY = -1;
      this.isDestroying = false;
      this.lastDestroyedX = -1;
      this.lastDestroyedY = -1;
    });

    window.addEventListener('keydown', (e) => {
      const speed = 10 / this.zoom;
      switch (e.key.toLowerCase()) {
        case 'w':
          this.cameraY -= speed;
          break;
        case 's':
          this.cameraY += speed;
          break;
        case 'a':
          this.cameraX -= speed;
          break;
        case 'd':
          this.cameraX += speed;
          break;
        case 'r':
          if (this.heldMachines.length > 0) {
            this.heldRotation = (this.heldRotation + 1) % 4;
          }
          break;
        case 'escape':
          this.heldMachines = [];
          this.heldRotation = 0;
          break;
      }
    });

    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = 0.1;
      if (e.deltaY < 0) {
        this.zoom *= 1 + zoomFactor;
      } else {
        this.zoom *= 1 - zoomFactor;
      }
      this.zoom = Math.max(0.1, Math.min(5, this.zoom));
    });

    window.addEventListener('resize', () => {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    });
  }

  private handlePaletteClick(y: number) {
    const buttonHeight = 50;
    const index = Math.floor(y / buttonHeight);
    if (index >= 0 && index < this.machines.length) {
      this.heldMachines = [this.machines[index]];
      this.heldRotation = 0;
    }
  }

  private placeMachine(screenX: number, screenY: number) {
    if (this.heldMachines.length === 0) return;

    const worldX = screenX / this.zoom + this.cameraX;
    const worldY = screenY / this.zoom + this.cameraY;
    const gridX = Math.floor(worldX / this.gridSize);
    const gridY = Math.floor(worldY / this.gridSize);

    // Avoid placing on the same cell multiple times during drag
    if (gridX === this.lastPlacedX && gridY === this.lastPlacedY) return;

    // Check collision
    if (!this.canPlace(this.heldMachines[0], gridX, gridY, this.heldRotation)) return;

    this.placedMachines.push({ machine: this.heldMachines[0], x: gridX, y: gridY, rotation: this.heldRotation });
    this.lastPlacedX = gridX;
    this.lastPlacedY = gridY;
  }

  private removeMachine(screenX: number, screenY: number) {
    const worldX = screenX / this.zoom + this.cameraX;
    const worldY = screenY / this.zoom + this.cameraY;
    const gridX = Math.floor(worldX / this.gridSize);
    const gridY = Math.floor(worldY / this.gridSize);

    // Avoid destroying the same cell multiple times during drag
    if (gridX === this.lastDestroyedX && gridY === this.lastDestroyedY) return;

    this.placedMachines = this.placedMachines.filter(pm => !(pm.x === gridX && pm.y === gridY));
    this.lastDestroyedX = gridX;
    this.lastDestroyedY = gridY;
  }

  private canPlace(machine: Machine, gridX: number, gridY: number, rotation: number): boolean {
    const w = rotation % 2 === 0 ? machine.width : machine.height;
    const h = rotation % 2 === 0 ? machine.height : machine.width;

    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const checkX = gridX + dx;
        const checkY = gridY + dy;

        if (this.placedMachines.some(pm => {
          const pmW = pm.rotation % 2 === 0 ? pm.machine.width : pm.machine.height;
          const pmH = pm.rotation % 2 === 0 ? pm.machine.height : pm.machine.width;
          return checkX >= pm.x && checkX < pm.x + pmW && checkY >= pm.y && checkY < pm.y + pmH;
        })) {
          return false;
        }
      }
    }
    return true;
  }

  private drawGrid() {
    this.ctx.save();
    this.ctx.translate(-this.cameraX * this.zoom, -this.cameraY * this.zoom);
    this.ctx.scale(this.zoom, this.zoom);

    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 1;

    const startX = Math.floor(this.cameraX / this.gridSize) * this.gridSize;
    const endX = startX + (this.canvas.width / this.zoom) + this.gridSize;
    const startY = Math.floor(this.cameraY / this.gridSize) * this.gridSize;
    const endY = startY + (this.canvas.height / this.zoom) + this.gridSize;

    for (let x = startX; x <= endX; x += this.gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, startY);
      this.ctx.lineTo(x, endY);
      this.ctx.stroke();
    }

    for (let y = startY; y <= endY; y += this.gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(startX, y);
      this.ctx.lineTo(endX, y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private drawPlacedMachines() {
    this.ctx.save();
    this.ctx.translate(-this.cameraX * this.zoom, -this.cameraY * this.zoom);
    this.ctx.scale(this.zoom, this.zoom);

    for (const pm of this.placedMachines) {
      this.drawMachine(pm.machine, pm.x * this.gridSize, pm.y * this.gridSize, false, pm.rotation);
    }

    this.ctx.restore();
  }

  private drawGhost() {
    if (this.heldMachines.length === 0) return;

    const worldX = this.mouseX / this.zoom + this.cameraX;
    const worldY = this.mouseY / this.zoom + this.cameraY;
    const gridX = Math.floor(worldX / this.gridSize);
    const gridY = Math.floor(worldY / this.gridSize);

    this.ctx.save();
    this.ctx.translate(-this.cameraX * this.zoom, -this.cameraY * this.zoom);
    this.ctx.scale(this.zoom, this.zoom);

    const canPlace = this.canPlace(this.heldMachines[0], gridX, gridY, this.heldRotation);
    this.ctx.globalAlpha = 0.5;

    this.drawMachine(this.heldMachines[0], gridX * this.gridSize, gridY * this.gridSize, true, this.heldRotation, canPlace);

    this.ctx.restore();
  }

  private drawMachine(machine: Machine, x: number, y: number, isGhost: boolean, rotation: number = 0, canPlace: boolean = true) {
    this.ctx.save();

    const centerX = x + (machine.width * this.gridSize) / 2;
    const centerY = y + (machine.height * this.gridSize) / 2;
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate((rotation * Math.PI) / 2);
    this.ctx.translate(-centerX, -centerY);

    // draw rect
    this.ctx.fillStyle = isGhost ? (canPlace ? 'lightblue' : 'red') : 'gray';
    this.ctx.fillRect(x, y, machine.width * this.gridSize, machine.height * this.gridSize);

    this.ctx.strokeStyle = 'white';
    this.ctx.strokeRect(x, y, machine.width * this.gridSize, machine.height * this.gridSize);

    // draw ports, rotated
    for (const port of machine.ports) {
      let rx = port.x, ry = port.y;
      for (let r = 0; r < rotation; r++) {
        const temp = rx;
        rx = machine.height - 1 - ry;
        ry = temp;
      }

      this.ctx.fillStyle = port.type === 'input' ? 'green' : 'red';
      this.ctx.beginPath();
      this.ctx.arc(x + rx * this.gridSize + this.gridSize / 2, y + ry * this.gridSize + this.gridSize / 2, 5, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // draw name
    this.ctx.fillStyle = 'white';
    this.ctx.font = '12px Arial';
    this.ctx.fillText(machine.name, x + 5, y + 20);

    this.ctx.restore();
  }

  private drawPalette() {
    // Background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.fillRect(this.canvas.width - this.paletteWidth, 0, this.paletteWidth, this.canvas.height);

    // Buttons
    const buttonHeight = 50;
    this.ctx.fillStyle = 'white';
    this.ctx.font = '16px Arial';
    for (let i = 0; i < this.machines.length; i++) {
      const y = i * buttonHeight;
      this.ctx.fillStyle = this.heldMachines.includes(this.machines[i]) ? 'yellow' : 'white';
      this.ctx.fillRect(this.canvas.width - this.paletteWidth, y, this.paletteWidth, buttonHeight);
      this.ctx.strokeStyle = 'gray';
      this.ctx.strokeRect(this.canvas.width - this.paletteWidth, y, this.paletteWidth, buttonHeight);
      this.ctx.fillStyle = 'black';
      this.ctx.fillText(this.machines[i].name, this.canvas.width - this.paletteWidth + 10, y + 30);
    }
  }

  private render() {
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawGrid();
    this.drawPlacedMachines();
    this.drawGhost();
    this.drawPalette();

    requestAnimationFrame(() => this.render());
  }

  start() {
    this.render();
  }
}