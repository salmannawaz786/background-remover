class NeuralNetworkBackground {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.nodes = [];
        this.mouse = { x: null, y: null, radius: 150 };
        this.numberOfNodes = 80;
        
        this.colors = {
            nodes: 'rgba(251, 191, 36, 0.8)',
            connections: 'rgba(251, 191, 36, 0.15)',
            mouseConnections: 'rgba(251, 191, 36, 0.4)',
            accent: 'rgba(255, 107, 107, 0.6)'
        };
        
        this.init();
        this.animate();
        this.setupEventListeners();
    }
    
    init() {
        this.resizeCanvas();
        this.createNodes();
    }
    
    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }
    
    createNodes() {
        this.nodes = [];
        for (let i = 0; i < this.numberOfNodes; i++) {
            this.nodes.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2 + 1,
                pulsePhase: Math.random() * Math.PI * 2
            });
        }
    }
    
    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.createNodes();
        });
        
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.x;
            this.mouse.y = e.y;
        });
        
        window.addEventListener('mouseout', () => {
            this.mouse.x = null;
            this.mouse.y = null;
        });
    }
    
    updateNodes() {
        this.nodes.forEach(node => {
            node.x += node.vx;
            node.y += node.vy;
            
            if (node.x < 0 || node.x > this.canvas.width) node.vx *= -1;
            if (node.y < 0 || node.y > this.canvas.height) node.vy *= -1;
            
            node.pulsePhase += 0.02;
        });
    }
    
    drawNodes() {
        this.nodes.forEach((node, index) => {
            const pulse = Math.sin(node.pulsePhase) * 0.5 + 0.5;
            const size = node.radius + pulse * 0.5;
            
            const gradient = this.ctx.createRadialGradient(
                node.x, node.y, 0,
                node.x, node.y, size * 2
            );
            
            if (index % 5 === 0) {
                gradient.addColorStop(0, this.colors.accent);
                gradient.addColorStop(1, 'rgba(255, 107, 107, 0)');
            } else {
                gradient.addColorStop(0, this.colors.nodes);
                gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
            }
            
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, size, 0, Math.PI * 2);
            this.ctx.fillStyle = gradient;
            this.ctx.fill();
            
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, size * 0.5, 0, Math.PI * 2);
            this.ctx.fillStyle = index % 5 === 0 ? 
                'rgba(255, 107, 107, 0.9)' : 
                'rgba(251, 191, 36, 0.9)';
            this.ctx.fill();
        });
    }
    
    drawConnections() {
        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const dx = this.nodes[i].x - this.nodes[j].x;
                const dy = this.nodes[i].y - this.nodes[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 120) {
                    const opacity = (1 - distance / 120) * 0.3;
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = `rgba(251, 191, 36, ${opacity})`;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.moveTo(this.nodes[i].x, this.nodes[i].y);
                    this.ctx.lineTo(this.nodes[j].x, this.nodes[j].y);
                    this.ctx.stroke();
                }
            }
        }
    }
    
    drawMouseConnections() {
        if (this.mouse.x === null || this.mouse.y === null) return;
        
        this.nodes.forEach(node => {
            const dx = this.mouse.x - node.x;
            const dy = this.mouse.y - node.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < this.mouse.radius) {
                const opacity = (1 - distance / this.mouse.radius) * 0.5;
                this.ctx.beginPath();
                this.ctx.strokeStyle = `rgba(251, 191, 36, ${opacity})`;
                this.ctx.lineWidth = 1;
                this.ctx.moveTo(node.x, node.y);
                this.ctx.lineTo(this.mouse.x, this.mouse.y);
                this.ctx.stroke();
                
                const force = (this.mouse.radius - distance) / this.mouse.radius;
                const angle = Math.atan2(dy, dx);
                node.x -= Math.cos(angle) * force * 0.5;
                node.y -= Math.sin(angle) * force * 0.5;
            }
        });
        
        const gradient = this.ctx.createRadialGradient(
            this.mouse.x, this.mouse.y, 0,
            this.mouse.x, this.mouse.y, 10
        );
        gradient.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
        gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
        
        this.ctx.beginPath();
        this.ctx.arc(this.mouse.x, this.mouse.y, 10, 0, Math.PI * 2);
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
    }
    
    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const gradient = this.ctx.createLinearGradient(0, 0, this.canvas.width, this.canvas.height);
        gradient.addColorStop(0, '#0f0f1e');
        gradient.addColorStop(0.5, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.updateNodes();
        this.drawConnections();
        this.drawNodes();
        this.drawMouseConnections();
        
        requestAnimationFrame(() => this.animate());
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('neural-network-canvas');
    if (canvas) {
        new NeuralNetworkBackground(canvas);
    }
});
