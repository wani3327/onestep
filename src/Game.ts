interface Coordinate {
    x: number,
    y: number
}

interface Port {
    x: number;
    y: number;
    type: 'input' | 'output';
    direction: number;
}

interface Machine {
    name: string;
    width: number;
    height: number;
    type?: string;
    ports: Port[];
}

interface PlacedMachine {
    machine: Machine;
    x: number;
    y: number;
    rotation: number;
}

interface PortRef {
    pm: PlacedMachine;
    port: Port;
    x: number;
    y: number;
    absDirection: number;
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
    private connections: { from: PortRef; to: PortRef; path: Coordinate[] }[] = [];
    private selectedPort: PortRef | null = null;
    private heldMachines: Machine[] = [];
    private heldRotation: number = 0;
    private mouseX: number = 0;
    private mouseY: number = 0;
    private isPlacing: boolean = false;
    private paletteWidth: number = 200;
    private lastPlacedX: number = -1;
    private lastPlacedY: number = -1;
    private isDestroying: boolean = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.loadMachines();
        this.setupEventListeners();
    }

    private async loadMachines() {
        try {
            const response = await fetch('data.json');
            const json = await response.json();
            this.machines = json.map((machine: any) => ({
                ...machine,
                ports: (machine.ports || []).map((port: any) => ({
                    x: Number(port.x),
                    y: Number(port.y),
                    type: port.type === 'input' ? 'input' : 'output',
                    direction: Number(port.direction) % 4,
                })),
            }));
        } catch (error) {
            console.error('Failed to load machines:', error);
        }
    }

    private getMouseGridPos(): { gx: number; gy: number; } {
        const worldX = this.mouseX / this.zoom + this.cameraX;
        const worldY = this.mouseY / this.zoom + this.cameraY;
        const gx = Math.floor(worldX / this.gridSize);
        const gy = Math.floor(worldY / this.gridSize);
        return { gx, gy };
    }

    private normalizeDirection(dir: number): number {
        const d = Number.isFinite(dir) ? Math.floor(dir) : 0;
        if (d === 4) return 1; // legacy up
        return ((d % 4) + 4) % 4;
    }

    private directionVector(dir: number): Coordinate {
        switch (this.normalizeDirection(dir)) {
            case 0: return { x: 1, y: 0 }; // +x
            case 1: return { x: 0, y: -1 }; // +y (up) in grid coordinate where y grows downwards
            case 2: return { x: -1, y: 0 }; // -x
            case 3: return { x: 0, y: 1 }; // -y (down)
        }
        return { x: 0, y: 0 };
    }

    private getPortAtGrid(gridX: number, gridY: number): PortRef | null {
        for (const pm of this.placedMachines) {
            for (const port of pm.machine.ports) {
                let rx = port.x;
                let ry = port.y;
                for (let r = 0; r < pm.rotation; r++) {
                    const temp = rx;
                    rx = pm.machine.height - 1 - ry;
                    ry = temp;
                }
                const px = pm.x + rx;
                const py = pm.y + ry;
                if (px === gridX && py === gridY) {
                    return {
                        pm,
                        port,
                        x: px,
                        y: py,
                        absDirection: this.normalizeDirection(port.direction + pm.rotation),
                    };
                }
            }
        }

        return null;
    }

    private getOccupiedCells(): Set<string> {
        const occupied = new Set<string>();
        for (const pm of this.placedMachines) {
            const w = pm.rotation % 2 === 0 ? pm.machine.width : pm.machine.height;
            const h = pm.rotation % 2 === 0 ? pm.machine.height : pm.machine.width;
            for (let dx = 0; dx < w; dx++) {
                for (let dy = 0; dy < h; dy++) {
                    occupied.add(`${pm.x + dx},${pm.y + dy}`);
                }
            }
        }
        return occupied;
    }

    private isCellBlocked(x: number, y: number, occupied: Set<string>): boolean {
        return occupied.has(`${x},${y}`);
    }

    private isLineClear(from: Coordinate, to: Coordinate, occupied: Set<string>): boolean {
        if (from.x !== to.x && from.y !== to.y) return false;

        const dx = Math.sign(to.x - from.x);
        const dy = Math.sign(to.y - from.y);

        let x = from.x;
        let y = from.y;

        while (true) {
            if (this.isCellBlocked(x, y, occupied)) return false;
            if (x === to.x && y === to.y) break;
            x += dx;
            y += dy;
        }

        return true;
    }

    private findBFSPath(start: Coordinate, goal: Coordinate, occupied: Set<string>): Coordinate[] | null {
        type Node = { x: number; y: number; dir: number; dist: number; turns: number; parent: Node | null };
        const dirs = [ {x:1,y:0}, {x:0,y:-1}, {x:-1,y:0}, {x:0,y:1} ];
        const key = (x:number,y:number,d:number) => `${x},${y},${d}`;

        const open: Node[] = [{ x: start.x, y: start.y, dir: -1, dist: 0, turns: 0, parent: null }];
        const visited = new Map<string, {dist:number;turns:number}>();

        while (open.length > 0) {
            open.sort((a,b) => a.turns - b.turns || a.dist - b.dist);
            const node = open.shift()!;

            if (node.x === goal.x && node.y === goal.y) {
                const path: Coordinate[] = [];
                let cur: Node | null = node;
                while (cur) {
                    path.unshift({ x: cur.x, y: cur.y });
                    cur = cur.parent;
                }
                return path;
            }

            const currentKey = key(node.x, node.y, node.dir);
            const prev = visited.get(currentKey);
            if (prev && (prev.turns < node.turns || (prev.turns === node.turns && prev.dist <= node.dist))) {
                continue;
            }
            visited.set(currentKey, { turns: node.turns, dist: node.dist });

            for (let d = 0; d < dirs.length; d++) {
                const nx = node.x + dirs[d].x;
                const ny = node.y + dirs[d].y;

                if (nx === start.x && ny === start.y) continue;
                if (this.isCellBlocked(nx, ny, occupied) && !(nx === goal.x && ny === goal.y)) continue;

                const nextTurns = node.dir < 0 || node.dir === d ? node.turns : node.turns + 1;
                const nextDist = node.dist + 1;
                const nextKey = key(nx, ny, d);
                const old = visited.get(nextKey);

                if (!old || old.turns > nextTurns || (old.turns === nextTurns && old.dist > nextDist)) {
                    open.push({ x: nx, y: ny, dir: d, dist: nextDist, turns: nextTurns, parent: node });
                }
            }
        }

        return null;
    }

    private computeConveyorPath(from: PortRef, to: PortRef): Coordinate[] {
        const fromDir = this.normalizeDirection(from.absDirection);
        const toDir = this.normalizeDirection(to.absDirection);
        const fromOffset = this.directionVector(fromDir);
        const toOffset = this.directionVector(toDir);

        const fromExit: Coordinate = { x: from.x + fromOffset.x, y: from.y + fromOffset.y };
        const toEntry: Coordinate = { x: to.x - toOffset.x, y: to.y - toOffset.y };

        const occupied = this.getOccupiedCells();
        // ports are allowed start/end points and do not block their own cells
        occupied.delete(`${from.x},${from.y}`);
        occupied.delete(`${to.x},${to.y}`);
        occupied.delete(`${fromExit.x},${fromExit.y}`);
        occupied.delete(`${toEntry.x},${toEntry.y}`);

        if (this.isCellBlocked(fromExit.x, fromExit.y, occupied) || this.isCellBlocked(toEntry.x, toEntry.y, occupied)) {
            return [];
        }

        let conveyorCells: Coordinate[] | null = null;

        if (fromExit.x === toEntry.x || fromExit.y === toEntry.y) {
            if (this.isLineClear(fromExit, toEntry, occupied)) {
                conveyorCells = [fromExit, toEntry];
            }
        }

        if (!conveyorCells) {
            const cornerA: Coordinate = { x: fromExit.x, y: toEntry.y };
            const cornerB: Coordinate = { x: toEntry.x, y: fromExit.y };

            if (this.isLineClear(fromExit, cornerA, occupied) && this.isLineClear(cornerA, toEntry, occupied)) {
                conveyorCells = [fromExit, cornerA, toEntry];
            } else if (this.isLineClear(fromExit, cornerB, occupied) && this.isLineClear(cornerB, toEntry, occupied)) {
                conveyorCells = [fromExit, cornerB, toEntry];
            }
        }

        if (!conveyorCells) {
            const bfs = this.findBFSPath(fromExit, toEntry, occupied);
            conveyorCells = bfs;
        }

        if (!conveyorCells) {
            return [];
        }

        const fullPath: Coordinate[] = [{ x: from.x, y: from.y }];
        for (const cell of conveyorCells) {
            fullPath.push(cell);
        }
        fullPath.push({ x: to.x, y: to.y });

        return fullPath;
    }

    private handlePortClick(clicked: PortRef) {
        if (!this.selectedPort) {
            this.selectedPort = clicked;
            return;
        }

        const samePort = this.selectedPort.pm === clicked.pm && this.selectedPort.port === clicked.port;
        if (samePort) {
            this.selectedPort = null;
            return;
        }

        let outputPort: PortRef | null = null;
        let inputPort: PortRef | null = null;

        if (this.selectedPort.port.type === 'output' && clicked.port.type === 'input') {
            outputPort = this.selectedPort;
            inputPort = clicked;
        } else if (this.selectedPort.port.type === 'input' && clicked.port.type === 'output') {
            outputPort = clicked;
            inputPort = this.selectedPort;
        } else {
            this.selectedPort = clicked;
            return;
        }

        const existing = this.connections.some(c => c.from === outputPort && c.to === inputPort);
        if (!existing && outputPort && inputPort) {
            const path = this.computeConveyorPath(outputPort, inputPort);
            if (path.length > 0) {
                this.connections.push({ from: outputPort, to: inputPort, path });
                this.placeConveyorsAlongPath(path);
            }
        }

        this.selectedPort = null;
    }

    private placeConveyorsAlongPath(path: Coordinate[]) {
        const conveyorMachine = this.machines.find(m => m.type === 'conveyor');
        if (!conveyorMachine) return;

        const occupied = this.getOccupiedCells();
        const pathCells = path.slice(1, path.length - 1); // fromExit..toEntry
        const placed = new Set<string>();

        for (const p of pathCells) {
            const key = `${p.x},${p.y}`;
            if (occupied.has(key)) continue;
            if (placed.has(key)) continue;

            this.placedMachines.push({ machine: conveyorMachine, x: p.x, y: p.y, rotation: 0 });
            placed.add(key);
            occupied.add(key);
        }
    }

    private setupEventListeners() {
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        this.canvas.addEventListener('mousedown', (e) => {
            let { cx, cy } = { cx: this.mouseX, cy: this.mouseY };
            let { gx, gy } = this.getMouseGridPos();

            if (cx > this.canvas.width - this.paletteWidth) {
                this.handlePaletteClick(cy);
            } else {
                if (e.button === 0 && this.heldMachines.length === 0) {
                    const clickedPort = this.getPortAtGrid(gx, gy);
                    if (clickedPort) {
                        this.handlePortClick(clickedPort);
                        return;
                    }
                }

                if (e.button === 0 && this.heldMachines.length > 0) { // left click
                    this.placeMachine(gx, gy);
                    this.isPlacing = true;
                } else if (e.button === 2) { // right click
                    this.removeMachine(gx, gy);
                    this.isDestroying = true;
                }
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;

            let { gx, gy } = this.getMouseGridPos()

            if (this.isPlacing && this.heldMachines.length > 0) {
                this.placeMachine(gx, gy);
            } else if (this.isDestroying) {
                this.removeMachine(gx, gy);
            }
        });

        window.addEventListener('mouseup', () => {
            this.isPlacing = false;
            this.lastPlacedX = -1;
            this.lastPlacedY = -1;
            this.isDestroying = false;
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

    private placeMachine(x: number, y: number) {
        if (this.heldMachines.length === 0) return;

        // Avoid placing on the same cell multiple times during drag
        if (x === this.lastPlacedX && y === this.lastPlacedY) return;

        // Check collision
        if (!this.canPlace(this.heldMachines[0], x, y, this.heldRotation)) return;

        this.placedMachines.push({ machine: this.heldMachines[0], x: x, y: y, rotation: this.heldRotation });
        this.lastPlacedX = x;
        this.lastPlacedY = y;
    }

    private removeMachine(x: number, y: number) {
        const removed = this.placedMachines.filter(pm => pm.x === x && pm.y === y);
        this.placedMachines = this.placedMachines.filter(pm => !(pm.x === x && pm.y === y));

        if (removed.length > 0) {
            this.connections = this.connections.filter(c => {
                const removeFromPort = removed.includes(c.from.pm);
                const removeToPort = removed.includes(c.to.pm);
                return !removeFromPort && !removeToPort;
            });
            if (this.selectedPort && removed.includes(this.selectedPort.pm)) {
                this.selectedPort = null;
            }
        }
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

    private drawConnections() {
        this.ctx.save();
        this.ctx.translate(-this.cameraX * this.zoom, -this.cameraY * this.zoom);
        this.ctx.scale(this.zoom, this.zoom);

        this.ctx.strokeStyle = 'yellow';
        this.ctx.lineWidth = 5;

        for (const conn of this.connections) {
            const points = conn.path.map(p => ({ x: p.x * this.gridSize + this.gridSize / 2, y: p.y * this.gridSize + this.gridSize / 2 }));
            if (points.length < 2) continue;

            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(points[i].x, points[i].y);
            }
            this.ctx.stroke();

            // arrow head at the end
            const last = points[points.length - 1];
            const prev = points[points.length - 2];
            const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
            const arrowSize = 6;
            this.ctx.fillStyle = 'yellow';
            this.ctx.beginPath();
            this.ctx.moveTo(last.x, last.y);
            this.ctx.lineTo(last.x - arrowSize * Math.cos(angle - Math.PI / 6), last.y - arrowSize * Math.sin(angle - Math.PI / 6));
            this.ctx.lineTo(last.x - arrowSize * Math.cos(angle + Math.PI / 6), last.y - arrowSize * Math.sin(angle + Math.PI / 6));
            this.ctx.closePath();
            this.ctx.fill();
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

            const globalX = Math.floor(x / this.gridSize) + rx;
            const globalY = Math.floor(y / this.gridSize) + ry;
            const isSelected = this.selectedPort && this.selectedPort.x === globalX && this.selectedPort.y === globalY;

            this.ctx.fillStyle = isSelected ? 'cyan' : (port.type === 'input' ? 'green' : 'red');
            this.ctx.beginPath();
            this.ctx.arc(x + rx * this.gridSize + this.gridSize / 2, y + ry * this.gridSize + this.gridSize / 2, isSelected ? 7 : 5, 0, Math.PI * 2);
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
        this.drawConnections();
        this.drawPlacedMachines();
        this.drawGhost();
        this.drawPalette();

        requestAnimationFrame(() => this.render());
    }

    start() {
        this.render();
    }
}