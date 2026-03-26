import { Game } from './Game';

document.body.style.margin = '0';
document.body.style.overflow = 'hidden';

const canvas = document.createElement('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
canvas.style.display = 'block';
document.body.appendChild(canvas);

const game = new Game(canvas);
game.start();