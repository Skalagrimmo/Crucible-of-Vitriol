// ============================================================================
// CRUCIBLE OF VITRIOL: A Gothic 2D Action Platformer Prototype
// ============================================================================
// CONTROLS:
// - Move Left / Right: [A] / [D] or [Left Arrow] / [Right Arrow]
// - Jump:              [Space] or [W] or [Up Arrow] (variable height + air control)
// - Melee Slash:       [J] or [Z] or [Enter]
// - Vitriol Flask:     [K] or [X] or [Shift] (Throws explosive alchemical flask)
// - Pause / Resume:    [P] or [Escape]
// - Restart:           [R]
// - Mobile:            On-screen Left/Right buttons and Jump/Slash/Flask action buttons.
//
// ARCHITECTURE & MAJOR SYSTEMS:
// 1. AudioSynthesizer: Pure Web Audio API chiptune SFX and dark gothic ambient drone.
// 2. InputHandler: Multi-touch event listener + Keyboard event listener with buffer.
// 3. Physics & AABB Collision: Delta-time stepping, one-way ledges, stairs & slope steps.
// 4. Combat & Hitbox Manager: Attack frames, non-repeating hit tracking, invulnerability.
// 5. Player Entity: 6 Health pips, Flask ammo, coyote time, jump buffering, knockback.
// 6. Enemy Archetypes:
//    - Ghoul Sentry: Ground melee patrol, edge-aware, lunges on sight.
//    - Blight Gargoyle: Flying swooper, sine hover & dive-bomb trajectory.
//    - Caustic Marksman: Ranged sniper on ledges, telegraphed laser aim & bolt.
//    - Crucible Ironclad: Slow heavy armor, high HP, telegraphed steam slam & shockwave.
// 7. Boss: "Lord Malakor, The Vitriol Chimera" (Multi-phase, telegraphs, 3 attacks).
// 8. Level Data: Hand-authored 3-stage continuous fortress (5200px length) + Checkpoints.
// 9. Particle & FX Engine: Blood splatters, chemical flames, steam, damage numbers, shake.
// 10. Renderer: Procedural gothic architecture, parallax ruins, lighting glows, HUD.
// ============================================================================

(function() {
  'use strict';

  // --- 1. AUDIO SYNTHESIZER (Pure Web Audio API, Zero Assets) ---
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.bgmTimer = null;
      this.bgmStep = 0;
    }

    init() {
      if (this.ctx) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch (e) {
        console.warn('AudioContext not supported');
      }
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playTone(freq, type = 'square', duration = 0.1, gainVal = 0.15, pitchDrop = 0) {
      if (!this.enabled || !this.ctx) return;
      try {
        this.resume();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (pitchDrop !== 0) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + pitchDrop), t + duration);
        }

        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + duration);
      } catch (e) {}
    }

    playNoise(duration = 0.15, gainVal = 0.12, lowpass = 1200) {
      if (!this.enabled || !this.ctx) return;
      try {
        this.resume();
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = lowpass;

        const gain = this.ctx.createGain();
        const t = this.ctx.currentTime;
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        noise.start(t);
      } catch (e) {}
    }

    jump() {
      this.playTone(180, 'square', 0.12, 0.12, 140);
    }

    slash() {
      this.playTone(420, 'triangle', 0.08, 0.15, -280);
      this.playNoise(0.06, 0.08, 2500);
    }

    hitEnemy() {
      this.playTone(160, 'sawtooth', 0.1, 0.22, -90);
      this.playNoise(0.08, 0.15, 900);
    }

    flaskThrow() {
      this.playTone(280, 'sine', 0.14, 0.1, 160);
    }

    flaskExplode() {
      this.playTone(90, 'sawtooth', 0.35, 0.3, -50);
      this.playNoise(0.3, 0.25, 600);
    }

    playerHurt() {
      this.playTone(240, 'sawtooth', 0.2, 0.3, -160);
      this.playNoise(0.2, 0.2, 500);
    }

    enemyDeath() {
      this.playTone(140, 'square', 0.22, 0.18, -80);
      this.playNoise(0.18, 0.15, 800);
    }

    checkpoint() {
      const notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          this.playTone(freq, 'sine', 0.3, 0.15);
        }, idx * 90);
      });
    }

    pickup() {
      this.playTone(523.25, 'triangle', 0.08, 0.15);
      setTimeout(() => this.playTone(659.25, 'triangle', 0.12, 0.15), 70);
    }

    bossRoar() {
      this.playTone(85, 'sawtooth', 0.6, 0.35, -45);
      this.playNoise(0.5, 0.3, 400);
    }

    bossSlam() {
      this.playTone(60, 'square', 0.4, 0.4, -30);
      this.playNoise(0.45, 0.35, 300);
    }

    victory() {
      const fanfares = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
      fanfares.forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'sine', 0.4, 0.2), i * 120);
      });
    }

    startBgm() {
      if (this.bgmTimer) return;
      const bassNotes = [55, 55, 65.41, 55, 49, 49, 58.27, 49]; // Dark gothic ostinato in A minor
      this.bgmTimer = setInterval(() => {
        if (!this.enabled || !this.ctx) return;
        const freq = bassNotes[this.bgmStep % bassNotes.length];
        this.playTone(freq, 'sawtooth', 0.22, 0.045, -5);
        if (this.bgmStep % 4 === 2) {
          this.playTone(freq * 1.5, 'triangle', 0.2, 0.03);
        }
        this.bgmStep++;
      }, 340);
    }
  }

  // --- 2. INPUT MANAGER (Keyboard + Touch) ---
  class InputManager {
    constructor() {
      this.keys = {
        left: false,
        right: false,
        jump: false,
        attack: false,
        flask: false,
        pause: false,
        restart: false
      };
      this.pressed = {
        jump: false,
        attack: false,
        flask: false,
        pause: false,
        restart: false
      };
      this.setupKeyboard();
      this.setupTouch();
    }

    setupKeyboard() {
      window.addEventListener('keydown', (e) => {
        const code = e.code;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
          e.preventDefault();
        }

        if (code === 'KeyA' || code === 'ArrowLeft') this.keys.left = true;
        if (code === 'KeyD' || code === 'ArrowRight') this.keys.right = true;

        if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') {
          if (!this.keys.jump) this.pressed.jump = true;
          this.keys.jump = true;
        }

        if (code === 'KeyJ' || code === 'KeyZ' || code === 'Enter') {
          if (!this.keys.attack) this.pressed.attack = true;
          this.keys.attack = true;
        }

        if (code === 'KeyK' || code === 'KeyX' || code === 'ShiftLeft' || code === 'ShiftRight') {
          if (!this.keys.flask) this.pressed.flask = true;
          this.keys.flask = true;
        }

        if (code === 'KeyP' || code === 'Escape') {
          this.pressed.pause = true;
          this.keys.pause = true;
        }

        if (code === 'KeyR') {
          this.pressed.restart = true;
          this.keys.restart = true;
        }
      });

      window.addEventListener('keyup', (e) => {
        const code = e.code;
        if (code === 'KeyA' || code === 'ArrowLeft') this.keys.left = false;
        if (code === 'KeyD' || code === 'ArrowRight') this.keys.right = false;
        if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') this.keys.jump = false;
        if (code === 'KeyJ' || code === 'KeyZ' || code === 'Enter') this.keys.attack = false;
        if (code === 'KeyK' || code === 'KeyX' || code === 'ShiftLeft' || code === 'ShiftRight') this.keys.flask = false;
        if (code === 'KeyP' || code === 'Escape') this.keys.pause = false;
        if (code === 'KeyR') this.keys.restart = false;
      });
    }

    setupTouch() {
      const bindBtn = (id, keyName, isAction = false) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        const start = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.keys[keyName] = true;
          if (isAction) this.pressed[keyName] = true;
          btn.classList.add('active');
          if (navigator.vibrate) {
            try { navigator.vibrate(15); } catch(e) {}
          }
        };

        const end = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.keys[keyName] = false;
          btn.classList.remove('active');
        };

        btn.addEventListener('touchstart', start, { passive: false });
        btn.addEventListener('touchend', end, { passive: false });
        btn.addEventListener('touchcancel', end, { passive: false });

        btn.addEventListener('mousedown', start);
        btn.addEventListener('mouseup', end);
        btn.addEventListener('mouseleave', end);
      };

      bindBtn('touch-left', 'left');
      bindBtn('touch-right', 'right');
      bindBtn('touch-jump', 'jump', true);
      bindBtn('touch-attack', 'attack', true);
      bindBtn('touch-flask', 'flask', true);
    }

    clearPressed() {
      this.pressed.jump = false;
      this.pressed.attack = false;
      this.pressed.flask = false;
      this.pressed.pause = false;
      this.pressed.restart = false;
    }
  }

  // --- 3. MATH & COLLISION HELPERS ---
  const AABB = {
    check(r1, r2) {
      return (
        r1.x < r2.x + r2.w &&
        r1.x + r1.w > r2.x &&
        r1.y < r2.y + r2.h &&
        r1.y + r1.h > r2.y
      );
    }
  };

  // --- 4. PARTICLE & VISUAL EFFECTS SYSTEM ---
  class Particle {
    constructor(x, y, vx, vy, color, size, life, gravity = 300) {
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.color = color;
      this.size = size;
      this.maxLife = life;
      this.life = life;
      this.gravity = gravity;
    }

    update(dt) {
      this.life -= dt;
      this.vy += this.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    draw(ctx, camX) {
      const alpha = Math.max(0, this.life / this.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.color;
      ctx.fillRect(this.x - camX - this.size / 2, this.y - this.size / 2, this.size, this.size);
      ctx.restore();
    }
  }

  class DamageNumber {
    constructor(x, y, text, color = '#f87171') {
      this.x = x;
      this.y = y;
      this.text = text;
      this.color = color;
      this.life = 0.75;
      this.maxLife = 0.75;
      this.vy = -50;
    }

    update(dt) {
      this.life -= dt;
      this.y += this.vy * dt;
    }

    draw(ctx, camX) {
      const alpha = Math.max(0, this.life / this.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = this.color;
      ctx.textAlign = 'center';
      ctx.fillText(this.text, this.x - camX, this.y);
      ctx.restore();
    }
  }

  // --- 5. PROJECTILES (Vitriol Flask, Acid Spurt, Boss Orbs) ---
  class Projectile {
    constructor(x, y, vx, vy, type, owner, damage = 1) {
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.type = type; // 'player_flask', 'enemy_bolt', 'boss_orb', 'shockwave'
      this.owner = owner; // 'player', 'enemy', 'boss'
      this.damage = damage;
      this.dead = false;
      this.radius = 6;
      this.gravity = (type === 'player_flask') ? 550 : 0;
      this.timer = (type === 'shockwave') ? 0.9 : 5.0;
      this.w = (type === 'shockwave') ? 24 : 12;
      this.h = (type === 'shockwave') ? 32 : 12;
    }

    update(dt, level, fx) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.dead = true;
        return;
      }

      this.vy += this.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Flask terrain hit -> explodes into corrosive vitriol splash
      if (this.type === 'player_flask') {
        const box = { x: this.x - 4, y: this.y - 4, w: 8, h: 8 };
        for (const plat of level.platforms) {
          if (AABB.check(box, plat)) {
            this.dead = true;
            fx.spawnExplosion(this.x, this.y, '#34d399', 24);
            fx.createAcidPuddle(this.x, plat.y, 48, 1.2, this.damage);
            break;
          }
        }
      }

      // Trail FX
      if (Math.random() < 0.4) {
        if (this.type === 'player_flask') {
          fx.addParticle(this.x, this.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, '#10b981', 3, 0.3, 50);
        } else if (this.type === 'boss_orb') {
          fx.addParticle(this.x, this.y, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, '#ec4899', 4, 0.4, 0);
        } else if (this.type === 'enemy_bolt') {
          fx.addParticle(this.x, this.y, 0, 0, '#a855f7', 3, 0.25, 0);
        }
      }
    }

    draw(ctx, camX) {
      const rx = this.x - camX;
      ctx.save();
      if (this.type === 'player_flask') {
        // Alchemical Glass Flask with bubbling green vitriol
        ctx.fillStyle = '#6ee7b7';
        ctx.beginPath();
        ctx.arc(rx, this.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#065f46';
        ctx.fillRect(rx - 2, this.y - 9, 4, 3); // flask neck
      } else if (this.type === 'boss_orb') {
        // Crimson-violet alchemical orb with pulsing core
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(rx, this.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe4e6';
        ctx.beginPath();
        ctx.arc(rx, this.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (this.type === 'shockwave') {
        // Jagged seismic wave
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(rx - this.w / 2, this.y - this.h, this.w, this.h);
        ctx.fillStyle = '#b45309';
        ctx.fillRect(rx - this.w / 4, this.y - this.h * 0.7, this.w / 2, this.h * 0.7);
      } else {
        // Caustic Bolt
        ctx.fillStyle = '#c084fc';
        ctx.beginPath();
        ctx.arc(rx, this.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // --- 6. PLAYER ENTITY ---
  class Player {
    constructor(x, y) {
      this.startX = x;
      this.startY = y;
      this.x = x;
      this.y = y;
      this.w = 26;
      this.h = 44;
      this.vx = 0;
      this.vy = 0;

      // Stats
      this.maxHp = 6;
      this.hp = 6;
      this.maxFlasks = 8;
      this.flasks = 5;

      // Movement parameters
      this.speed = 210;
      this.jumpForce = -420;
      this.gravity = 980;
      this.facing = 1; // 1 = right, -1 = left
      this.onGround = false;

      // Combat states
      this.isAttacking = false;
      this.attackTimer = 0;
      this.attackDuration = 0.28;
      this.attackCooldown = 0;
      this.attackHasHit = new Set();

      this.invulnTimer = 0;
      this.knockbackTimer = 0;

      // Jump feel: Coyote time & Jump buffering
      this.coyoteTime = 0;
      this.jumpBuffer = 0;

      this.isDead = false;
      this.deathTimer = 0;

      // Animation frame tracker
      this.animTime = 0;
    }

    respawn(cpX, cpY) {
      this.x = cpX;
      this.y = cpY;
      this.vx = 0;
      this.vy = 0;
      this.hp = this.maxHp;
      this.flasks = Math.max(this.flasks, 3); // Restock minimum flasks on respawn
      this.isDead = false;
      this.deathTimer = 0;
      this.invulnTimer = 1.0;
      this.isAttacking = false;
    }

    takeDamage(amount, fromX, audio, fx) {
      if (this.invulnTimer > 0 || this.isDead) return;

      this.hp -= amount;
      this.invulnTimer = 1.0;
      this.knockbackTimer = 0.22;
      this.isAttacking = false;

      // Knockback away from damage source
      const dir = (this.x + this.w / 2 >= fromX) ? 1 : -1;
      this.vx = dir * 180;
      this.vy = -220;

      audio.playerHurt();
      fx.spawnBlood(this.x + this.w / 2, this.y + this.h / 2, '#ef4444', 16);
      fx.screenShake(6, 0.25);
      fx.addDamageNumber(this.x + this.w / 2, this.y - 10, `-${amount}`, '#ef4444');

      if (this.hp <= 0) {
        this.hp = 0;
        this.isDead = true;
        this.deathTimer = 1.6;
      }
    }

    update(dt, input, level, audio, fx, projectiles) {
      if (this.isDead) {
        this.deathTimer -= dt;
        return;
      }

      this.animTime += dt;
      if (this.invulnTimer > 0) this.invulnTimer -= dt;
      if (this.knockbackTimer > 0) this.knockbackTimer -= dt;
      if (this.attackCooldown > 0) this.attackCooldown -= dt;

      // Coyote time & Jump buffer
      if (this.onGround) {
        this.coyoteTime = 0.12;
      } else {
        this.coyoteTime -= dt;
      }

      if (input.pressed.jump) {
        this.jumpBuffer = 0.14;
      } else if (this.jumpBuffer > 0) {
        this.jumpBuffer -= dt;
      }

      // Horizontal movement (only if not locked in knockback)
      if (this.knockbackTimer <= 0) {
        let moveDir = 0;
        if (input.keys.left) moveDir -= 1;
        if (input.keys.right) moveDir += 1;

        if (moveDir !== 0) {
          this.facing = moveDir;
          // Smooth acceleration
          this.vx = moveDir * this.speed;
        } else {
          // Deceleration
          this.vx *= this.onGround ? 0.72 : 0.88;
          if (Math.abs(this.vx) < 5) this.vx = 0;
        }

        // Jump Execution
        if (this.jumpBuffer > 0 && this.coyoteTime > 0) {
          this.vy = this.jumpForce;
          this.coyoteTime = 0;
          this.jumpBuffer = 0;
          this.onGround = false;
          audio.jump();
          fx.addDust(this.x + this.w / 2, this.y + this.h, 6);
        }

        // Variable jump height: release early cuts upward velocity
        if (!input.keys.jump && this.vy < -120) {
          this.vy *= 0.6;
        }

        // Melee Attack Input
        if (input.pressed.attack && this.attackCooldown <= 0 && !this.isAttacking) {
          this.isAttacking = true;
          this.attackTimer = this.attackDuration;
          this.attackCooldown = 0.36;
          this.attackHasHit.clear();
          audio.slash();
          fx.addSlashFX(this.x + (this.facing === 1 ? this.w : -24), this.y + 12, this.facing);
        }

        // Ranged Flask Input
        if (input.pressed.flask && this.flasks > 0 && !this.isAttacking) {
          this.flasks--;
          audio.flaskThrow();
          const throwVx = this.facing * 340 + this.vx * 0.4;
          const throwVy = -260;
          projectiles.push(new Projectile(
            this.x + (this.facing === 1 ? this.w + 4 : -8),
            this.y + 14,
            throwVx,
            throwVy,
            'player_flask',
            'player',
            3
          ));
        }
      }

      // Melee attack lifecycle
      if (this.isAttacking) {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          this.isAttacking = false;
        }
      }

      // Apply Gravity
      this.vy += this.gravity * dt;
      if (this.vy > 650) this.vy = 650; // Terminal velocity

      // Physics Integration & Tile Collision with Stair Stepping
      this.moveAndCollide(dt, level, fx);

      // Check Death Pit / Acid floor
      if (this.y > 600 && !this.isDead) {
        this.takeDamage(99, this.x, audio, fx);
      }
    }

    getMeleeHitbox() {
      if (!this.isAttacking || this.attackTimer < 0.06) return null;
      const reach = 36;
      return {
        x: this.facing === 1 ? this.x + this.w : this.x - reach,
        y: this.y + 4,
        w: reach,
        h: this.h - 8
      };
    }

    moveAndCollide(dt, level, fx) {
      // Horizontal move & collision
      this.x += this.vx * dt;
      let playerBox = { x: this.x, y: this.y, w: this.w, h: this.h };

      for (const plat of level.platforms) {
        if (plat.isOneWay) continue; // One-way only blocks downward
        if (AABB.check(playerBox, plat)) {
          // Stair Step handling: if obstruction is <= 10px high, step up smoothly!
          const stepHeight = (plat.y - (this.y + this.h));
          if (stepHeight >= -12 && stepHeight < 0 && this.vy >= 0) {
            this.y = plat.y - this.h;
            playerBox.y = this.y;
            this.onGround = true;
          } else {
            if (this.vx > 0) {
              this.x = plat.x - this.w;
            } else if (this.vx < 0) {
              this.x = plat.x + plat.w;
            }
            this.vx = 0;
            playerBox.x = this.x;
          }
        }
      }

      // Vertical move & collision
      this.y += this.vy * dt;
      playerBox = { x: this.x, y: this.y, w: this.w, h: this.h };
      this.onGround = false;

      for (const plat of level.platforms) {
        if (plat.isOneWay) {
          // Only collide if falling down and player feet were above platform top
          const prevFeet = (this.y - this.vy * dt) + this.h;
          if (this.vy >= 0 && prevFeet <= plat.y + 6 && AABB.check(playerBox, plat)) {
            this.y = plat.y - this.h;
            this.vy = 0;
            this.onGround = true;
            playerBox.y = this.y;
          }
        } else {
          if (AABB.check(playerBox, plat)) {
            if (this.vy > 0) {
              this.y = plat.y - this.h;
              this.vy = 0;
              this.onGround = true;
            } else if (this.vy < 0) {
              this.y = plat.y + plat.h;
              this.vy = 0;
            }
            playerBox.y = this.y;
          }
        }
      }
    }

    draw(ctx, camX) {
      if (this.isDead) return;

      // Invulnerability flicker
      if (this.invulnTimer > 0 && Math.floor(this.animTime * 24) % 2 === 0) {
        return;
      }

      const rx = this.x - camX;
      ctx.save();

      // Shadow on ground
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(rx + this.w / 2, this.y + this.h, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Hunter Coat / Cloak
      ctx.fillStyle = '#1e293b'; // Slate dark coat
      ctx.fillRect(rx + 4, this.y + 12, this.w - 8, this.h - 14);

      // Tattered Cloak tail flapping
      const runOffset = Math.sin(this.animTime * 12) * (Math.abs(this.vx) > 10 ? 4 : 1);
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(rx + (this.facing === 1 ? 4 : this.w - 4), this.y + 18);
      ctx.lineTo(rx + (this.facing === 1 ? -8 : this.w + 8), this.y + this.h + runOffset);
      ctx.lineTo(rx + this.w / 2, this.y + this.h - 2);
      ctx.fill();

      // Legs / Boots
      ctx.fillStyle = '#334155';
      ctx.fillRect(rx + 6, this.y + this.h - 8, 5, 8);
      ctx.fillRect(rx + this.w - 11, this.y + this.h - 8, 5, 8);

      // Hunter Mask / Brimmed Tricorn Hat
      ctx.fillStyle = '#475569';
      ctx.fillRect(rx + 6, this.y + 4, this.w - 12, 10); // Face
      // Glowing eye slit
      ctx.fillStyle = '#38bdf8';
      const eyeX = this.facing === 1 ? rx + this.w - 10 : rx + 8;
      ctx.fillRect(eyeX, this.y + 7, 3, 2);

      // Hat Brim
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(rx + 1, this.y + 1, this.w - 2, 4);
      ctx.fillRect(rx + 5, this.y - 3, this.w - 10, 4);

      // Brass Alchemical Vials on Belt
      ctx.fillStyle = '#10b981';
      ctx.fillRect(rx + (this.facing === 1 ? 8 : 14), this.y + 24, 3, 5);

      // Quicksilver Blade in hand / attack arc
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      if (this.isAttacking) {
        // Dynamic slash arc
        ctx.strokeStyle = '#38bdf8';
        ctx.beginPath();
        const startAngle = this.facing === 1 ? -0.8 : Math.PI + 0.8;
        const endAngle = this.facing === 1 ? 0.9 : Math.PI - 0.9;
        ctx.arc(
          rx + (this.facing === 1 ? this.w + 2 : -2),
          this.y + 20,
          26,
          startAngle,
          endAngle,
          this.facing === -1
        );
        ctx.stroke();
      } else {
        // Sheathed or held sword
        ctx.beginPath();
        const hx = rx + (this.facing === 1 ? this.w - 4 : 4);
        ctx.moveTo(hx, this.y + 18);
        ctx.lineTo(hx + this.facing * 8, this.y + 36);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // --- 7. ENEMY ARCHETYPES ---
  // Archetype 1: Ground Melee (Ghoul Sentry)
  // Archetype 2: Flying Enemy (Blight Gargoyle)
  // Archetype 3: Ranged Enemy (Caustic Marksman)
  // Archetype 4: Slow Durable Enemy (Crucible Ironclad)
  class Enemy {
    constructor(x, y, type) {
      this.startX = x;
      this.startY = y;
      this.x = x;
      this.y = y;
      this.type = type;
      this.dead = false;
      this.facing = -1;
      this.timer = 0;
      this.state = 'patrol'; // 'patrol', 'alert', 'attack', 'recover'
      this.hasHitPlayer = false;

      if (type === 'ghoul') {
        // Ground Melee: Fast, patrols platforms, lunges when player is near
        this.w = 28;
        this.h = 42;
        this.maxHp = 3;
        this.hp = 3;
        this.speed = 85;
        this.lungeSpeed = 180;
        this.vx = -this.speed;
        this.vy = 0;
        this.damage = 1;
      } else if (type === 'gargoyle') {
        // Flying Enemy: Undulating sine wave hover, swoops in arc when player approaches
        this.w = 32;
        this.h = 28;
        this.maxHp = 2;
        this.hp = 2;
        this.speed = 110;
        this.vx = 0;
        this.vy = 0;
        this.baseY = y;
        this.damage = 1;
      } else if (type === 'marksman') {
        // Ranged Enemy: Stations on platforms, charges and fires toxic bolt
        this.w = 26;
        this.h = 44;
        this.maxHp = 3;
        this.hp = 3;
        this.vx = 0;
        this.vy = 0;
        this.damage = 1;
        this.shootCooldown = 2.4;
        this.aimTimer = 0;
      } else if (type === 'ironclad') {
        // Slow Durable Enemy: Heavy boiler armor, telegraphs overhead cleave, shockwave
        this.w = 44;
        this.h = 56;
        this.maxHp = 12;
        this.hp = 12;
        this.speed = 42;
        this.vx = -this.speed;
        this.vy = 0;
        this.damage = 2;
        this.slamTimer = 0;
        this.isSlamming = false;
      }
    }

    takeDamage(amount, fx, audio) {
      this.hp -= amount;
      audio.hitEnemy();
      fx.spawnBlood(this.x + this.w / 2, this.y + this.h / 2, '#34d399', 12);
      fx.addDamageNumber(this.x + this.w / 2, this.y - 12, `${amount}`, '#fcd34d');

      if (this.hp <= 0) {
        this.dead = true;
        audio.enemyDeath();
        fx.spawnExplosion(this.x + this.w / 2, this.y + this.h / 2, '#94a3b8', 20);
        // Chance to drop alchemical flask ammo or heal
        if (Math.random() < 0.45) {
          fx.spawnPickup(this.x + this.w / 2, this.y + this.h / 2, 'flask');
        }
      }
    }

    update(dt, player, level, projectiles, fx, audio) {
      if (this.dead) return;
      this.timer += dt;

      const distToPlayer = Math.hypot(
        (player.x + player.w / 2) - (this.x + this.w / 2),
        (player.y + player.h / 2) - (this.y + this.h / 2)
      );

      // --- Archetype 1: Ghoul Sentry ---
      if (this.type === 'ghoul') {
        this.vy += 900 * dt;
        if (distToPlayer < 180 && Math.abs(player.y - this.y) < 40) {
          // Alert / Lunge towards player
          this.facing = (player.x > this.x) ? 1 : -1;
          this.vx = this.facing * this.lungeSpeed;
        } else {
          // Normal Patrol
          this.vx = this.facing * this.speed;
        }

        // Ledge & Wall Detection
        this.x += this.vx * dt;
        let onLedge = false;
        const checkX = this.x + (this.facing === 1 ? this.w + 4 : -4);
        const feetBox = { x: checkX, y: this.y + this.h + 2, w: 4, h: 8 };

        for (const plat of level.platforms) {
          if (AABB.check(feetBox, plat)) {
            onLedge = true;
            break;
          }
        }
        if (!onLedge && distToPlayer >= 180) {
          this.facing *= -1;
          this.vx = this.facing * this.speed;
        }

        this.applyGravityAndCollide(dt, level);
      }

      // --- Archetype 2: Blight Gargoyle (Flyer) ---
      else if (this.type === 'gargoyle') {
        if (distToPlayer < 240) {
          // Swoop down towards player
          const targetX = player.x;
          const targetY = player.y - 10;
          const angle = Math.atan2(targetY - this.y, targetX - this.x);
          this.vx = Math.cos(angle) * this.speed;
          this.vy = Math.sin(angle) * this.speed;
          this.facing = this.vx >= 0 ? 1 : -1;
        } else {
          // Sine wave hover around baseY
          this.vx = Math.sin(this.timer * 2) * 40;
          this.y = this.baseY + Math.sin(this.timer * 4) * 25;
          this.vy = 0;
        }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
      }

      // --- Archetype 3: Caustic Marksman (Ranged) ---
      else if (this.type === 'marksman') {
        this.applyGravityAndCollide(dt, level);
        this.facing = (player.x > this.x) ? 1 : -1;

        if (distToPlayer < 360) {
          this.aimTimer += dt;
          // Telegraph: Laser guide / charging spark
          if (this.aimTimer >= this.shootCooldown - 0.7) {
            if (Math.random() < 0.3) {
              fx.addParticle(
                this.x + (this.facing === 1 ? this.w + 6 : -6),
                this.y + 16,
                (Math.random() - 0.5) * 20,
                (Math.random() - 0.5) * 20,
                '#c084fc',
                3,
                0.2,
                0
              );
            }
          }

          if (this.aimTimer >= this.shootCooldown) {
            this.aimTimer = 0;
            // Fire chemical bolt
            const boltVx = this.facing * 260;
            projectiles.push(new Projectile(
              this.x + (this.facing === 1 ? this.w + 4 : -12),
              this.y + 18,
              boltVx,
              0,
              'enemy_bolt',
              'enemy',
              1
            ));
            audio.playTone(320, 'triangle', 0.1, 0.1, -120);
          }
        } else {
          this.aimTimer = 0;
        }
      }

      // --- Archetype 4: Crucible Ironclad (Slow Heavy Brute) ---
      else if (this.type === 'ironclad') {
        this.facing = (player.x > this.x) ? 1 : -1;

        if (distToPlayer < 120 && Math.abs(player.y - this.y) < 40 && !this.isSlamming) {
          // Start Slam Telegraph
          this.isSlamming = true;
          this.slamTimer = 0.8; // 0.8s telegraph time
          this.vx = 0;
          audio.playTone(110, 'sawtooth', 0.3, 0.2, 30); // Steam rev
          fx.addSteam(this.x + this.w / 2, this.y + 10, 8);
        }

        if (this.isSlamming) {
          this.slamTimer -= dt;
          // Steam vent particles during windup
          if (Math.random() < 0.4) {
            fx.addSteam(this.x + (this.facing === 1 ? -6 : this.w + 6), this.y + 14, 2);
          }

          if (this.slamTimer <= 0) {
            // Slam ground!
            this.isSlamming = false;
            audio.bossSlam();
            fx.screenShake(5, 0.2);
            fx.spawnExplosion(this.x + (this.facing === 1 ? this.w + 8 : -8), this.y + this.h, '#fbbf24', 16);

            // Create shockwave projectile moving in front
            projectiles.push(new Projectile(
              this.x + (this.facing === 1 ? this.w + 12 : -24),
              this.y + this.h - 4,
              this.facing * 240,
              0,
              'shockwave',
              'enemy',
              2
            ));
          }
        } else {
          // Slow steady advance
          this.vx = this.facing * this.speed;
          this.x += this.vx * dt;
        }

        this.applyGravityAndCollide(dt, level);
      }

      // Check contact damage with player
      const enemyBox = { x: this.x, y: this.y, w: this.w, h: this.h };
      const playerBox = { x: player.x, y: player.y, w: player.w, h: player.h };
      if (AABB.check(enemyBox, playerBox)) {
        player.takeDamage(this.damage, this.x + this.w / 2, audio, fx);
      }
    }

    applyGravityAndCollide(dt, level) {
      this.vy += 900 * dt;
      if (this.vy > 650) this.vy = 650;
      this.y += this.vy * dt;

      const box = { x: this.x, y: this.y, w: this.w, h: this.h };
      for (const plat of level.platforms) {
        if (plat.isOneWay) {
          if (this.vy >= 0 && AABB.check(box, plat) && this.y + this.h - this.vy * dt <= plat.y + 6) {
            this.y = plat.y - this.h;
            this.vy = 0;
            break;
          }
        } else if (AABB.check(box, plat)) {
          if (this.vy > 0) {
            this.y = plat.y - this.h;
            this.vy = 0;
          }
          break;
        }
      }
    }

    draw(ctx, camX) {
      if (this.dead) return;
      const rx = this.x - camX;
      ctx.save();

      if (this.type === 'ghoul') {
        // Ghoul Sentry: Rusted plates, hunchback, sickle arms
        ctx.fillStyle = '#475569';
        ctx.fillRect(rx + 4, this.y + 10, this.w - 8, this.h - 10);
        // Glowing yellow eyes
        ctx.fillStyle = '#fde047';
        const eyeX = this.facing === 1 ? rx + this.w - 8 : rx + 6;
        ctx.fillRect(eyeX, this.y + 8, 3, 3);
        // Rusted cleaver arm
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(rx + (this.facing === 1 ? this.w - 4 : -6), this.y + 16, 10, 5);
      } else if (this.type === 'gargoyle') {
        // Blight Gargoyle: Bat wings, stony body
        ctx.fillStyle = '#334155';
        ctx.fillRect(rx + 6, this.y + 6, this.w - 12, this.h - 10);
        // Wings flapping
        const flap = Math.sin(this.timer * 14) * 8;
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.moveTo(rx + 6, this.y + 10);
        ctx.lineTo(rx - 10, this.y - 4 + flap);
        ctx.lineTo(rx + 4, this.y + 18);
        ctx.moveTo(rx + this.w - 6, this.y + 10);
        ctx.lineTo(rx + this.w + 10, this.y - 4 + flap);
        ctx.lineTo(rx + this.w - 4, this.y + 18);
        ctx.fill();
        // Red glowing eyes
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(rx + (this.facing === 1 ? this.w - 12 : 8), this.y + 10, 3, 2);
      } else if (this.type === 'marksman') {
        // Caustic Marksman: Hooded cowl, brass siphon gun
        ctx.fillStyle = '#2e1065';
        ctx.fillRect(rx + 4, this.y + 12, this.w - 8, this.h - 14);
        ctx.fillStyle = '#581c87';
        ctx.fillRect(rx + 5, this.y + 4, this.w - 10, 10); // Hood
        // Aiming laser beam telegraph
        if (this.aimTimer >= this.shootCooldown - 0.7) {
          ctx.strokeStyle = 'rgba(192, 132, 252, 0.6)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(rx + (this.facing === 1 ? this.w : 0), this.y + 18);
          ctx.lineTo(rx + (this.facing === 1 ? 320 : -320), this.y + 18);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // Brass gun
        ctx.fillStyle = '#d97706';
        ctx.fillRect(rx + (this.facing === 1 ? this.w - 6 : -10), this.y + 16, 16, 5);
      } else if (this.type === 'ironclad') {
        // Crucible Ironclad: Giant boiler mech armor
        ctx.fillStyle = '#1c1917';
        ctx.fillRect(rx + 4, this.y + 8, this.w - 8, this.h - 8);
        // Furnace belly glow (telegraph turns red hot!)
        ctx.fillStyle = this.isSlamming ? '#ef4444' : '#f97316';
        ctx.fillRect(rx + 10, this.y + 24, this.w - 20, 14);
        // Heavy Hammer
        ctx.fillStyle = '#78716c';
        const hammerY = this.isSlamming ? this.y - 12 : this.y + 14;
        ctx.fillRect(rx + (this.facing === 1 ? this.w - 6 : -18), hammerY, 20, 16);
      }

      ctx.restore();
    }
  }

  // --- 8. MULTI-PHASE BOSS: LORD MALAKOR, THE VITRIOL CHIMERA ---
  class Boss {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.w = 68;
      this.h = 82;
      this.vx = 0;
      this.vy = 0;
      this.facing = -1;

      this.maxHp = 32;
      this.hp = 32;
      this.phase = 1; // 1 = Normal, 2 = Enraged (<= 16 HP)
      this.active = false;
      this.dead = false;
      this.deathTimer = 0;

      // State machine
      this.state = 'idle'; // 'idle', 'telegraph', 'volley', 'leap', 'cleave', 'recover'
      this.stateTimer = 1.0;
      this.nextAttack = 'volley'; // 'volley', 'leap', 'cleave'
      this.attackIndex = 0;

      this.telegraphType = '';
      this.invulnTimer = 0;
      this.animTime = 0;
      this.roarDone = false;
    }

    takeDamage(amount, fx, audio) {
      if (this.invulnTimer > 0 || this.dead || !this.active) return;
      this.hp -= amount;
      this.invulnTimer = 0.22;
      audio.hitEnemy();
      fx.spawnBlood(this.x + this.w / 2, this.y + this.h / 2, '#ec4899', 16);
      fx.addDamageNumber(this.x + this.w / 2, this.y - 16, `${amount}`, '#ec4899');
      fx.screenShake(3, 0.15);

      // Phase 2 Transition (at 50% HP)
      if (this.hp <= 16 && this.phase === 1) {
        this.phase = 2;
        audio.bossRoar();
        fx.spawnExplosion(this.x + this.w / 2, this.y + this.h / 2, '#ef4444', 36);
        fx.screenShake(10, 0.6);
        this.state = 'telegraph';
        this.stateTimer = 1.0;
        this.telegraphType = 'roar';
      }

      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        this.deathTimer = 2.4;
        audio.bossRoar();
        fx.screenShake(12, 1.2);
      }
    }

    update(dt, player, level, projectiles, fx, audio) {
      if (!this.active) return;

      this.animTime += dt;
      if (this.invulnTimer > 0) this.invulnTimer -= dt;

      if (this.dead) {
        this.deathTimer -= dt;
        if (Math.random() < 0.4) {
          fx.spawnExplosion(
            this.x + Math.random() * this.w,
            this.y + Math.random() * this.h,
            '#fbbf24',
            12
          );
        }
        return;
      }

      this.facing = (player.x > this.x) ? 1 : -1;
      this.stateTimer -= dt;

      // Phase multiplier
      const speedMult = this.phase === 2 ? 1.35 : 1.0;
      const cooldownMult = this.phase === 2 ? 0.65 : 1.0;

      // Boss States
      switch (this.state) {
        case 'idle':
          this.vx = 0;
          if (this.stateTimer <= 0) {
            // Pick next attack in rotation
            const attacks = ['volley', 'leap', 'cleave'];
            this.nextAttack = attacks[this.attackIndex % attacks.length];
            this.attackIndex++;

            this.state = 'telegraph';
            this.telegraphType = this.nextAttack;
            this.stateTimer = 0.75 * cooldownMult;

            // Telegraph Sound & Particles
            if (this.nextAttack === 'volley') {
              audio.playTone(340, 'triangle', 0.3, 0.2, 100);
            } else if (this.nextAttack === 'leap') {
              audio.playTone(180, 'square', 0.3, 0.25, 60);
              fx.addSteam(this.x + this.w / 2, this.y + this.h, 12);
            } else if (this.nextAttack === 'cleave') {
              audio.playTone(280, 'sawtooth', 0.3, 0.25, -80);
            }
          }
          break;

        case 'telegraph':
          this.vx = 0;
          // Spawn charge sparks/steam
          if (Math.random() < 0.5) {
            const glowColor = (this.phase === 2) ? '#ef4444' : '#34d399';
            fx.addParticle(
              this.x + this.w / 2 + (Math.random() - 0.5) * 40,
              this.y + 30 + (Math.random() - 0.5) * 40,
              0,
              -30,
              glowColor,
              4,
              0.3,
              0
            );
          }

          if (this.stateTimer <= 0) {
            this.state = this.telegraphType;
            if (this.state === 'volley') {
              this.stateTimer = 0.6;
              this.fireVolley(player, projectiles, audio);
            } else if (this.state === 'leap') {
              this.stateTimer = 1.4;
              // Leap up towards player position!
              const targetX = player.x;
              const dx = targetX - this.x;
              this.vx = Math.max(-280, Math.min(280, dx * 1.5)) * speedMult;
              this.vy = -540;
              audio.jump();
            } else if (this.state === 'cleave') {
              this.stateTimer = 0.55;
              this.vx = this.facing * 340 * speedMult;
              audio.slash();
              fx.addSlashFX(this.x + (this.facing === 1 ? this.w : -30), this.y + 30, this.facing);
            } else {
              this.state = 'idle';
              this.stateTimer = 0.6;
            }
          }
          break;

        case 'volley':
          this.vx = 0;
          if (this.stateTimer <= 0) {
            this.state = 'idle';
            this.stateTimer = 0.8 * cooldownMult;
          }
          break;

        case 'leap':
          // Falling towards ground
          if (this.vy > 0) {
            // Check landing on arena floor
            for (const plat of level.platforms) {
              if (AABB.check({ x: this.x, y: this.y + 6, w: this.w, h: this.h }, plat)) {
                this.y = plat.y - this.h;
                this.vy = 0;
                this.vx = 0;
                this.state = 'idle';
                this.stateTimer = 0.9 * cooldownMult;

                // Slam impacts ground! Twin shockwaves left and right!
                audio.bossSlam();
                fx.screenShake(9, 0.45);
                fx.spawnExplosion(this.x + this.w / 2, this.y + this.h, '#fbbf24', 28);

                projectiles.push(new Projectile(this.x - 20, this.y + this.h - 8, -260, 0, 'shockwave', 'boss', 2));
                projectiles.push(new Projectile(this.x + this.w + 10, this.y + this.h - 8, 260, 0, 'shockwave', 'boss', 2));
                break;
              }
            }
          }
          break;

        case 'cleave':
          // Dashing slash
          this.x += this.vx * dt;
          if (this.stateTimer <= 0) {
            this.vx = 0;
            this.state = 'idle';
            this.stateTimer = 0.7 * cooldownMult;
          }
          break;
      }

      // Gravity integration
      this.vy += 920 * dt;
      if (this.vy > 700) this.vy = 700;
      this.y += this.vy * dt;

      // Platform Collisions
      const box = { x: this.x, y: this.y, w: this.w, h: this.h };
      for (const plat of level.platforms) {
        if (!plat.isOneWay && AABB.check(box, plat)) {
          if (this.vy > 0) {
            this.y = plat.y - this.h;
            this.vy = 0;
          }
        }
      }

      // Arena horizontal clamping (Arena is x: 4400 to 5160)
      if (this.x < 4420) { this.x = 4420; this.vx = 0; }
      if (this.x > 5120) { this.x = 5120; this.vx = 0; }

      // Contact damage with player
      const bossBox = { x: this.x, y: this.y, w: this.w, h: this.h };
      const playerBox = { x: player.x, y: player.y, w: player.w, h: player.h };
      if (AABB.check(bossBox, playerBox)) {
        player.takeDamage(2, this.x + this.w / 2, audio, fx);
      }
    }

    fireVolley(player, projectiles, audio) {
      audio.flaskExplode();
      const count = (this.phase === 2) ? 5 : 3;
      const baseAngle = (this.facing === 1) ? 0 : Math.PI;

      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * 0.28;
        const angle = baseAngle + spread;
        const speed = 260;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 60;

        projectiles.push(new Projectile(
          this.x + this.w / 2,
          this.y + 28,
          vx,
          vy,
          'boss_orb',
          'boss',
          1
        ));
      }
    }

    draw(ctx, camX) {
      if (!this.active) return;
      const rx = this.x - camX;
      ctx.save();

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(rx + this.w / 2, this.y + this.h, 34, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Massive Chimera Torso (Brass pipes + dark alchemical flesh)
      ctx.fillStyle = (this.phase === 2) ? '#450a0a' : '#1e1b4b';
      ctx.fillRect(rx + 8, this.y + 16, this.w - 16, this.h - 22);

      // Chemical Boiler Furnace in chest
      const furnaceColor = (this.phase === 2) ? '#ef4444' : '#10b981';
      ctx.fillStyle = furnaceColor;
      ctx.fillRect(rx + 18, this.y + 26, this.w - 36, 22);

      // Boiler Glass Grate Bars
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.strokeRect(rx + 18, this.y + 26, this.w - 36, 22);

      // Horned Alchemical Mask / Helm
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(rx + 14, this.y, this.w - 28, 18);
      // Horns
      ctx.beginPath();
      ctx.moveTo(rx + 16, this.y);
      ctx.lineTo(rx + 4, this.y - 14);
      ctx.lineTo(rx + 22, this.y + 4);
      ctx.moveTo(rx + this.w - 16, this.y);
      ctx.lineTo(rx + this.w + 4, this.y - 14);
      ctx.lineTo(rx + this.w - 22, this.y + 4);
      ctx.fill();

      // Glowing Eyes
      ctx.fillStyle = (this.phase === 2) ? '#fbbf24' : '#38bdf8';
      const eyeOffset = this.facing === 1 ? 8 : -8;
      ctx.fillRect(rx + this.w / 2 + eyeOffset - 6, this.y + 6, 5, 4);
      ctx.fillRect(rx + this.w / 2 + eyeOffset + 2, this.y + 6, 5, 4);

      // Scythe Blade Arm
      ctx.strokeStyle = (this.state === 'cleave') ? '#f43f5e' : '#cbd5e1';
      ctx.lineWidth = 6;
      ctx.beginPath();
      const armX = rx + (this.facing === 1 ? this.w - 4 : 4);
      ctx.moveTo(armX, this.y + 24);
      ctx.lineTo(armX + this.facing * 34, this.y + 54);
      ctx.stroke();

      // Telegraph Danger Aura
      if (this.state === 'telegraph') {
        ctx.strokeStyle = (this.phase === 2) ? 'rgba(239, 68, 68, 0.8)' : 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx - 4, this.y - 4, this.w + 8, this.h + 8);
      }

      ctx.restore();
    }
  }

  // --- 9. HAND-AUTHORED LEVEL DESIGN & SECTIONS ---
  // Length: 5200px across 3 continuous gameplay sections
  // Section 1: 0 - 1700px (Outer Cloister Ramparts)
  // Section 2: 1700 - 3400px (Grand Chemical Laboratory - Checkpoint 1 at 1720)
  // Section 3: 3400 - 5200px (Crucible Aqueduct & Boss Chamber - Checkpoint 2 at 3450)
  function createLevelData() {
    const platforms = [];
    const hazards = [];
    const enemies = [];
    const pickups = [];
    const checkpoints = [];

    // Helper to add platform
    const addPlat = (x, y, w, h, isOneWay = false) => {
      platforms.push({ x, y, w, h, isOneWay });
    };

    // --- SECTION 1: OUTER CLOISTER RAMPARTS (x: 0 to 1700) ---
    // Ground foundation with gaps & stairs
    addPlat(0, 480, 420, 60);
    // Teaching jump over pit 1
    addPlat(480, 480, 360, 60);
    // Stairs ascending
    addPlat(740, 440, 90, 40);
    addPlat(830, 400, 100, 80);
    // High ruined rampart
    addPlat(960, 360, 220, 20); // one way or solid
    addPlat(1220, 380, 260, 20);
    // Ground resumes before entrance
    addPlat(1100, 480, 580, 60);

    // Section 1 Enemies
    enemies.push(new Enemy(320, 440, 'ghoul'));
    enemies.push(new Enemy(640, 440, 'ghoul'));
    enemies.push(new Enemy(1040, 300, 'gargoyle')); // swooping bat
    enemies.push(new Enemy(1360, 340, 'ghoul'));

    // Section 1 Pickups
    pickups.push({ x: 260, y: 450, type: 'flask' });
    pickups.push({ x: 1020, y: 320, type: 'flask' });

    // --- SECTION 2: THE GRAND CHEMICAL LABORATORY (x: 1700 to 3400) ---
    // Checkpoint 1 at Laboratory entrance
    checkpoints.push({ id: 1, x: 1720, y: 436, activated: false });

    // Multi-tiered scaffolding, acid vats below
    addPlat(1680, 480, 280, 60);
    // Toxic Acid Pit on floor from 1960 to 2400 (hazard!)
    hazards.push({ x: 1960, y: 520, w: 440, h: 20, type: 'acid' });
    // Suspended laboratory platforms over acid
    addPlat(2000, 420, 100, 16, true);
    addPlat(2140, 360, 110, 16, true);
    addPlat(2290, 410, 90, 16, true);

    // High Balcony for Marksman
    addPlat(2100, 250, 180, 16);
    enemies.push(new Enemy(2180, 200, 'marksman'));

    // Middle Lab Floor
    addPlat(2420, 480, 420, 60);
    enemies.push(new Enemy(2520, 440, 'ghoul'));
    // First Crucible Ironclad guarding the distillation chamber!
    enemies.push(new Enemy(2720, 420, 'ironclad'));

    // Scaffold stairs leading upward
    addPlat(2880, 430, 90, 16, true);
    addPlat(3000, 380, 100, 16, true);
    addPlat(3140, 330, 240, 16);
    enemies.push(new Enemy(3240, 280, 'marksman'));
    enemies.push(new Enemy(2950, 220, 'gargoyle'));

    // Section 2 Pickups
    pickups.push({ x: 2460, y: 445, type: 'heal' });
    pickups.push({ x: 3180, y: 295, type: 'flask' });

    // --- SECTION 3: FURNACE AQUEDUCT & CRUCIBLE GATE (x: 3400 to 5200) ---
    // Checkpoint 2 at 3450
    checkpoints.push({ id: 2, x: 3450, y: 436, activated: false });

    addPlat(3380, 480, 320, 60);
    // Elevation drop and steam pipes
    addPlat(3740, 440, 180, 20);
    addPlat(3960, 400, 180, 20);
    enemies.push(new Enemy(3800, 400, 'ghoul'));
    enemies.push(new Enemy(4020, 350, 'gargoyle'));

    // Pre-Boss Gauntlet with Ironclad and Marksman
    addPlat(4180, 480, 260, 60);
    enemies.push(new Enemy(4260, 420, 'ironclad'));

    // Section 3 Pickup
    pickups.push({ x: 3820, y: 405, type: 'flask' });
    pickups.push({ x: 4300, y: 445, type: 'heal' });

    // --- GRAND CRUCIBLE ARENA (x: 4440 to 5200) ---
    // Solid arena floor with side stone pillars
    addPlat(4440, 480, 760, 60);
    // Side platforms for dodging boss attacks
    addPlat(4520, 370, 110, 16, true);
    addPlat(4980, 370, 110, 16, true);
    // Closed left gate (activates when boss triggers)
    // Left boundary: 4440, Right boundary: 5180

    return { platforms, hazards, enemies, pickups, checkpoints };
  }

  // --- 10. MAIN GAME CONTROLLER & RENDERER ---
  class Game {
    constructor() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d');

      this.audio = new SoundEngine();
      this.input = new InputManager();

      this.state = 'title'; // 'title', 'playing', 'paused', 'victory', 'gameover'
      this.lastTime = 0;
      this.gameTime = 0;

      // Camera
      this.camX = 0;
      this.camTargetX = 0;
      this.screenWidth = 960;
      this.screenHeight = 540;

      // FX & Entities
      this.particles = [];
      this.damageNumbers = [];
      this.projectiles = [];
      this.shakeIntensity = 0;
      this.shakeDuration = 0;

      // Stats
      this.enemiesSlain = 0;
      this.flasksUsed = 0;

      this.initLevel();
      this.setupUI();
    }

    initLevel() {
      this.level = createLevelData();
      this.player = new Player(60, 436);
      this.activeCheckpoint = { x: 60, y: 436 };
      this.boss = new Boss(4800, 398);
      this.bossTriggered = false;
      this.arenaLocked = false;
    }

    setupUI() {
      // Audio toggle button
      const sndBtn = document.getElementById('btn-sound');
      if (sndBtn) {
        sndBtn.addEventListener('click', () => {
          this.audio.init();
          this.audio.enabled = !this.audio.enabled;
          sndBtn.textContent = this.audio.enabled ? '🔊 AUDIO' : '🔇 MUTED';
        });
      }

      // Reset button
      const rstBtn = document.getElementById('btn-restart');
      if (rstBtn) {
        rstBtn.addEventListener('click', () => {
          this.resetGame();
        });
      }

      // Touch controls toggle
      const touchBtn = document.getElementById('btn-touch-toggle');
      const touchControls = document.getElementById('touch-controls');
      if (touchBtn && touchControls) {
        let touchVisible = true;
        touchBtn.addEventListener('click', () => {
          touchVisible = !touchVisible;
          touchControls.style.display = touchVisible ? 'flex' : 'none';
        });
      }

      // Start audio on first user touch/click anywhere
      const unlockAudio = () => {
        this.audio.init();
        this.audio.resume();
        this.audio.startBgm();
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      };
      window.addEventListener('pointerdown', unlockAudio);
      window.addEventListener('keydown', unlockAudio);
    }

    resetGame() {
      this.initLevel();
      this.state = 'playing';
      this.gameTime = 0;
      this.enemiesSlain = 0;
      this.flasksUsed = 0;
    }

    // FX API
    addParticle(x, y, vx, vy, color, size, life, gravity) {
      this.particles.push(new Particle(x, y, vx, vy, color, size, life, gravity));
    }

    spawnBlood(x, y, color = '#ef4444', count = 12) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 50 + Math.random() * 140;
        this.addParticle(x, y, Math.cos(angle) * spd, Math.sin(angle) * spd - 60, color, 3, 0.4, 450);
      }
    }

    spawnExplosion(x, y, color = '#34d399', count = 20) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 60 + Math.random() * 220;
        this.addParticle(x, y, Math.cos(angle) * spd, Math.sin(angle) * spd - 40, color, 4, 0.5, 300);
      }
    }

    addSlashFX(x, y, dir) {
      for (let i = 0; i < 8; i++) {
        this.addParticle(
          x + dir * i * 4,
          y + (Math.random() - 0.5) * 20,
          dir * (80 + Math.random() * 120),
          (Math.random() - 0.5) * 60,
          '#38bdf8',
          3,
          0.18,
          0
        );
      }
    }

    addSteam(x, y, count = 4) {
      for (let i = 0; i < count; i++) {
        this.addParticle(
          x + (Math.random() - 0.5) * 14,
          y,
          (Math.random() - 0.5) * 30,
          -40 - Math.random() * 60,
          '#94a3b8',
          4,
          0.6,
          -20
        );
      }
    }

    addDust(x, y, count = 5) {
      for (let i = 0; i < count; i++) {
        this.addParticle(x, y, (Math.random() - 0.5) * 80, -20 - Math.random() * 40, '#64748b', 3, 0.3, 100);
      }
    }

    createAcidPuddle(x, y, width, duration, damage) {
      // Corrosive pool on the floor
      const puddleBox = { x: x - width / 2, y: y - 8, w: width, h: 12 };
      this.level.hazards.push({
        ...puddleBox,
        type: 'acid_pool',
        timer: duration,
        damage: damage
      });
    }

    spawnPickup(x, y, type) {
      this.level.pickups.push({ x, y, type });
    }

    addDamageNumber(x, y, text, color) {
      this.damageNumbers.push(new DamageNumber(x, y, text, color));
    }

    screenShake(intensity, duration) {
      this.shakeIntensity = intensity;
      this.shakeDuration = duration;
    }

    // --- GAME LOOP ---
    start() {
      const loop = (timestamp) => {
        if (!this.lastTime) this.lastTime = timestamp;
        let dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        // Cap unusually large delta values (e.g. background tab)
        if (dt > 0.05) dt = 0.05;

        this.update(dt);
        this.render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    update(dt) {
      // Screen shake update
      if (this.shakeDuration > 0) {
        this.shakeDuration -= dt;
      } else {
        this.shakeIntensity = 0;
      }

      // Title Screen
      if (this.state === 'title') {
        if (this.input.pressed.jump || this.input.pressed.attack || this.input.pressed.flask) {
          this.state = 'playing';
          this.audio.init();
          this.audio.startBgm();
        }
        this.input.clearPressed();
        return;
      }

      // Pause toggle
      if (this.input.pressed.pause) {
        this.state = (this.state === 'playing') ? 'paused' : 'playing';
      }
      if (this.state === 'paused') {
        this.input.clearPressed();
        return;
      }

      // Quick restart
      if (this.input.pressed.restart) {
        this.resetGame();
        this.input.clearPressed();
        return;
      }

      // Victory / Game Over states
      if (this.state === 'victory' || this.state === 'gameover') {
        if (this.input.pressed.jump || this.input.pressed.attack) {
          this.resetGame();
        }
        this.input.clearPressed();
        return;
      }

      this.gameTime += dt;

      // Update Player
      this.player.update(dt, this.input, this.level, this.audio, this, this.projectiles);

      // Player Death & Respawn Check
      if (this.player.isDead && this.player.deathTimer <= 0) {
        this.player.respawn(this.activeCheckpoint.x, this.activeCheckpoint.y);
      }

      // Checkpoints activation
      for (const cp of this.level.checkpoints) {
        if (!cp.activated && Math.abs(this.player.x - cp.x) < 32 && Math.abs(this.player.y - cp.y) < 60) {
          cp.activated = true;
          this.activeCheckpoint = { x: cp.x, y: cp.y };
          this.audio.checkpoint();
          this.spawnExplosion(cp.x + 12, cp.y + 12, '#38bdf8', 24);
          this.addDamageNumber(cp.x + 12, cp.y - 14, 'CHECKPOINT ACTIVE', '#38bdf8');
        }
      }

      // Pickups collection
      for (let i = this.level.pickups.length - 1; i >= 0; i--) {
        const item = this.level.pickups[i];
        const dist = Math.hypot((this.player.x + this.player.w / 2) - item.x, (this.player.y + this.player.h / 2) - item.y);
        if (dist < 26) {
          this.audio.pickup();
          if (item.type === 'flask') {
            this.player.flasks = Math.min(this.player.maxFlasks, this.player.flasks + 3);
            this.addDamageNumber(item.x, item.y - 12, '+3 FLASKS', '#34d399');
          } else if (item.type === 'heal') {
            this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2);
            this.addDamageNumber(item.x, item.y - 12, '+2 HP', '#f43f5e');
          }
          this.spawnExplosion(item.x, item.y, '#34d399', 10);
          this.level.pickups.splice(i, 1);
        }
      }

      // Combat: Player Melee attack collision with enemies & boss
      const meleeBox = this.player.getMeleeHitbox();
      if (meleeBox) {
        for (const enemy of this.level.enemies) {
          if (!enemy.dead && !this.player.attackHasHit.has(enemy)) {
            const enemyBox = { x: enemy.x, y: enemy.y, w: enemy.w, h: enemy.h };
            if (AABB.check(meleeBox, enemyBox)) {
              this.player.attackHasHit.add(enemy);
              enemy.takeDamage(2, this, this.audio);
              if (enemy.dead) this.enemiesSlain++;
            }
          }
        }
        if (this.boss.active && !this.boss.dead && !this.player.attackHasHit.has(this.boss)) {
          const bossBox = { x: this.boss.x, y: this.boss.y, w: this.boss.w, h: this.boss.h };
          if (AABB.check(meleeBox, bossBox)) {
            this.player.attackHasHit.add(this.boss);
            this.boss.takeDamage(2, this, this.audio);
          }
        }
      }

      // Projectiles update & collision
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        p.update(dt, this.level, this);

        const pBox = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };

        // Player projectile hitting enemies or boss
        if (p.owner === 'player') {
          for (const enemy of this.level.enemies) {
            if (!enemy.dead) {
              const eBox = { x: enemy.x, y: enemy.y, w: enemy.w, h: enemy.h };
              if (AABB.check(pBox, eBox)) {
                enemy.takeDamage(p.damage, this, this.audio);
                p.dead = true;
                if (enemy.dead) this.enemiesSlain++;
                break;
              }
            }
          }
          if (this.boss.active && !this.boss.dead) {
            const bBox = { x: this.boss.x, y: this.boss.y, w: this.boss.w, h: this.boss.h };
            if (AABB.check(pBox, bBox)) {
              this.boss.takeDamage(p.damage, this, this.audio);
              p.dead = true;
            }
          }
        }

        // Enemy or Boss projectile hitting player
        if (p.owner === 'enemy' || p.owner === 'boss') {
          const playerBox = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
          if (AABB.check(pBox, playerBox)) {
            this.player.takeDamage(p.damage, p.x, this.audio, this);
            p.dead = true;
          }
        }

        if (p.dead) {
          this.projectiles.splice(i, 1);
        }
      }

      // Update Hazards (Acid pools, dripping acid)
      for (let i = this.level.hazards.length - 1; i >= 0; i--) {
        const hz = this.level.hazards[i];
        if (hz.timer !== undefined) {
          hz.timer -= dt;
          if (hz.timer <= 0) {
            this.level.hazards.splice(i, 1);
            continue;
          }
        }
        const pBox = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
        if (AABB.check(hz, pBox)) {
          this.player.takeDamage(hz.damage || 1, hz.x + hz.w / 2, this.audio, this);
        }
      }

      // Update Enemies
      for (const enemy of this.level.enemies) {
        enemy.update(dt, this.player, this.level, this.projectiles, this, this.audio);
      }

      // Trigger Boss when entering Arena (x > 4440)
      if (this.player.x > 4440 && !this.bossTriggered) {
        this.bossTriggered = true;
        this.boss.active = true;
        this.arenaLocked = true;
        this.audio.bossRoar();
        this.screenShake(8, 0.6);
        // Seal Left Arena Gate
        this.level.platforms.push({ x: 4420, y: 320, w: 20, h: 160, isOneWay: false });
      }

      // Update Boss
      if (this.boss.active) {
        this.boss.update(dt, this.player, this.level, this.projectiles, this, this.audio);
        if (this.boss.dead && this.boss.deathTimer <= 0) {
          this.state = 'victory';
          this.audio.victory();
        }
      }

      // Update Particles & FX
      for (let i = this.particles.length - 1; i >= 0; i--) {
        this.particles[i].update(dt);
        if (this.particles[i].life <= 0) this.particles.splice(i, 1);
      }

      for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
        this.damageNumbers[i].update(dt);
        if (this.damageNumbers[i].life <= 0) this.damageNumbers.splice(i, 1);
      }

      // Update Camera (Horizontal follow with damping)
      this.camTargetX = this.player.x - this.screenWidth * 0.38;
      if (this.arenaLocked) {
        // Clamp camera strictly to arena
        this.camTargetX = Math.max(4400, Math.min(5200 - this.screenWidth, this.camTargetX));
      } else {
        this.camTargetX = Math.max(0, Math.min(5200 - this.screenWidth, this.camTargetX));
      }
      this.camX += (this.camTargetX - this.camX) * 0.12;

      this.input.clearPressed();
    }

    // --- RENDERER ---
    render() {
      const ctx = this.ctx;
      ctx.save();

      // Apply screen shake
      if (this.shakeIntensity > 0) {
        const ox = (Math.random() - 0.5) * this.shakeIntensity;
        const oy = (Math.random() - 0.5) * this.shakeIntensity;
        ctx.translate(ox, oy);
      }

      ctx.clearRect(0, 0, this.screenWidth, this.screenHeight);

      // 1. Parallax Gothic Background
      this.drawBackground(ctx);

      // 2. Level Architecture & Hazards
      this.drawLevel(ctx);

      // 3. Checkpoints & Pickups
      this.drawInteractables(ctx);

      // 4. Enemies & Boss
      for (const enemy of this.level.enemies) {
        enemy.draw(ctx, this.camX);
      }
      this.boss.draw(ctx, this.camX);

      // 5. Player
      this.player.draw(ctx, this.camX);

      // 6. Projectiles & Particles
      for (const p of this.projectiles) {
        p.draw(ctx, this.camX);
      }
      for (const pt of this.particles) {
        pt.draw(ctx, this.camX);
      }
      for (const dn of this.damageNumbers) {
        dn.draw(ctx, this.camX);
      }

      // 7. Atmospheric Vignette & Foreground Light Glows
      this.drawAtmosphere(ctx);

      ctx.restore();

      // 8. HUD & Overlays
      this.drawHUD(ctx);
      if (this.state === 'title') this.drawTitleScreen(ctx);
      if (this.state === 'paused') this.drawPauseScreen(ctx);
      if (this.state === 'victory') this.drawVictoryScreen(ctx);
      if (this.state === 'gameover') this.drawGameOverScreen(ctx);
    }

    drawBackground(ctx) {
      // Deep night sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, this.screenHeight);
      skyGrad.addColorStop(0, '#090a10');
      skyGrad.addColorStop(0.6, '#131722');
      skyGrad.addColorStop(1, '#1e2433');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);

      // Sickly Chemical Moon
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(this.screenWidth * 0.78, 90, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(254, 240, 138, 0.12)';
      ctx.beginPath();
      ctx.arc(this.screenWidth * 0.78, 90, 72, 0, Math.PI * 2);
      ctx.fill();

      // Parallax Layer 1: Distant Gothic Spires & Buttresses (0.2x speed)
      ctx.fillStyle = '#0f131c';
      const offset1 = -(this.camX * 0.2) % 360;
      for (let x = offset1 - 360; x < this.screenWidth + 360; x += 180) {
        ctx.beginPath();
        ctx.moveTo(x, 480);
        ctx.lineTo(x + 30, 260);
        ctx.lineTo(x + 40, 180);
        ctx.lineTo(x + 50, 260);
        ctx.lineTo(x + 80, 480);
        ctx.fill();
      }

      // Parallax Layer 2: Midground Laboratory Arches & Steaming Pipes (0.45x speed)
      ctx.fillStyle = '#171d2b';
      const offset2 = -(this.camX * 0.45) % 480;
      for (let x = offset2 - 480; x < this.screenWidth + 480; x += 240) {
        // Gothic pointed arch window with chemical green back-glow
        ctx.fillRect(x + 20, 280, 70, 200);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
        ctx.fillRect(x + 35, 310, 40, 90);
        ctx.fillStyle = '#171d2b';
        // Rusted iron horizontal pipes
        ctx.fillRect(x - 60, 240, 300, 12);
      }
    }

    drawLevel(ctx) {
      // Platforms: Weathered gothic stone blocks & brass scaffolding
      for (const plat of this.level.platforms) {
        const rx = plat.x - this.camX;
        if (rx + plat.w < -50 || rx > this.screenWidth + 50) continue;

        if (plat.isOneWay) {
          // Metal scaffolding beam
          ctx.fillStyle = '#334155';
          ctx.fillRect(rx, plat.y, plat.w, plat.h);
          ctx.fillStyle = '#64748b';
          ctx.fillRect(rx, plat.y, plat.w, 3);
          // Bolts
          for (let b = 10; b < plat.w; b += 24) {
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(rx + b, plat.y + 4, 3, 3);
          }
        } else {
          // Stone masonry blocks
          ctx.fillStyle = '#1e2430';
          ctx.fillRect(rx, plat.y, plat.w, plat.h);
          // Top stone cap highlight
          ctx.fillStyle = '#3a4454';
          ctx.fillRect(rx, plat.y, plat.w, 4);
          // Mortar seams
          ctx.strokeStyle = '#0d1017';
          ctx.lineWidth = 2;
          for (let sx = 0; sx < plat.w; sx += 48) {
            ctx.beginPath();
            ctx.moveTo(rx + sx, plat.y);
            ctx.lineTo(rx + sx, plat.y + plat.h);
            ctx.stroke();
          }
        }
      }

      // Hazards: Glowing bubbling acid pools
      for (const hz of this.level.hazards) {
        const rx = hz.x - this.camX;
        ctx.fillStyle = '#059669';
        ctx.fillRect(rx, hz.y, hz.w, hz.h);
        // Toxic surface froth
        ctx.fillStyle = '#34d399';
        ctx.fillRect(rx, hz.y, hz.w, 3);
        if (Math.random() < 0.2) {
          this.addParticle(
            hz.x + Math.random() * hz.w,
            hz.y,
            (Math.random() - 0.5) * 10,
            -30 - Math.random() * 20,
            '#6ee7b7',
            3,
            0.4,
            -10
          );
        }
      }
    }

    drawInteractables(ctx) {
      // Checkpoints: Alchemical Resonator Beacons
      for (const cp of this.level.checkpoints) {
        const rx = cp.x - this.camX;
        // Stone pedestal
        ctx.fillStyle = '#334155';
        ctx.fillRect(rx - 8, cp.y + 20, 36, 24);
        // Glass Alembic Vessel
        ctx.fillStyle = cp.activated ? '#38bdf8' : '#64748b';
        ctx.beginPath();
        ctx.arc(rx + 10, cp.y + 12, 12, 0, Math.PI * 2);
        ctx.fill();
        // Glowing core
        if (cp.activated) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(rx + 10, cp.y + 12, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Pickups: Floating glowing bottles
      for (const item of this.level.pickups) {
        const rx = item.x - this.camX;
        const bob = Math.sin(this.gameTime * 4) * 4;
        ctx.save();
        if (item.type === 'flask') {
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.arc(rx, item.y + bob, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#065f46';
          ctx.fillRect(rx - 2, item.y + bob - 12, 4, 4);
        } else if (item.type === 'heal') {
          ctx.fillStyle = '#f43f5e';
          ctx.beginPath();
          ctx.arc(rx, item.y + bob, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(rx - 1, item.y + bob - 4, 2, 8);
          ctx.fillRect(rx - 4, item.y + bob - 1, 8, 2);
        }
        ctx.restore();
      }
    }

    drawAtmosphere(ctx) {
      // Dark vignette around viewport edges
      const vig = ctx.createRadialGradient(
        this.screenWidth / 2,
        this.screenHeight / 2,
        this.screenWidth * 0.35,
        this.screenWidth / 2,
        this.screenHeight / 2,
        this.screenWidth * 0.7
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(3, 4, 7, 0.7)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);
    }

    drawHUD(ctx) {
      ctx.save();

      // Top-Left: Gothic Health Alembics
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(16, 16, 210, 48);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(16, 16, 210, 48);

      // Health Hearts / Pips
      for (let i = 0; i < this.player.maxHp; i++) {
        const px = 28 + i * 18;
        const py = 30;
        ctx.fillStyle = (i < this.player.hp) ? '#ef4444' : '#334155';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = '10px monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('VITALITY', 28, 54);

      // Flask Ammo Counter
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(150, 32, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`×${this.player.flasks}`, 164, 37);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('VITRIOL', 150, 54);

      // Boss Health Bar (Centered Top when Boss is Active)
      if (this.boss.active && !this.boss.dead) {
        const barWidth = 380;
        const barX = (this.screenWidth - barWidth) / 2;
        const barY = 24;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(barX - 4, barY - 18, barWidth + 8, 36);
        ctx.strokeStyle = (this.boss.phase === 2) ? '#ef4444' : '#94a3b8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(barX - 4, barY - 18, barWidth + 8, 36);

        // Boss Title
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = (this.boss.phase === 2) ? '#f87171' : '#e2e8f0';
        ctx.textAlign = 'center';
        const phaseLabel = (this.boss.phase === 2) ? ' [ENRAGED PHASE II]' : '';
        ctx.fillText(`LORD MALAKOR, THE VITRIOL CHIMERA${phaseLabel}`, this.screenWidth / 2, barY - 4);

        // Health Fill
        const pct = Math.max(0, this.boss.hp / this.boss.maxHp);
        ctx.fillStyle = '#334155';
        ctx.fillRect(barX, barY + 2, barWidth, 10);
        ctx.fillStyle = (this.boss.phase === 2) ? '#ef4444' : '#a855f7';
        ctx.fillRect(barX, barY + 2, barWidth * pct, 10);
      }

      ctx.restore();
    }

    drawTitleScreen(ctx) {
      ctx.fillStyle = 'rgba(5, 6, 10, 0.85)';
      ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#38bdf8';
      ctx.font = '13px monospace';
      ctx.fillText('AN ORIGINAL GOTHIC 2D ACTION PLATFORMER', this.screenWidth / 2, 140);

      ctx.font = 'bold 42px serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('CRUCIBLE OF VITRIOL', this.screenWidth / 2, 195);

      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Purify the ruined alchemical fortress and vanquish Lord Malakor.', this.screenWidth / 2, 230);

      // Controls Summary Box
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.fillRect(this.screenWidth / 2 - 240, 260, 480, 110);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.strokeRect(this.screenWidth / 2 - 240, 260, 480, 110);

      ctx.font = '12px monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('KEYBOARD: [A]/[D] Move | [SPACE] Jump | [J] Slash | [K] Flask', this.screenWidth / 2, 290);
      ctx.fillText('TOUCH: Use on-screen Left/Right and Action buttons below', this.screenWidth / 2, 315);
      ctx.fillText('SYSTEM: Checkpoints save progress | Conserve Vitriol Flasks', this.screenWidth / 2, 340);

      // Pulsing Start Prompt
      const pulse = Math.sin(this.lastTime / 250) * 0.3 + 0.7;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('▶ TAP ANYWHERE OR PRESS JUMP TO BEGIN', this.screenWidth / 2, 420);
      ctx.globalAlpha = 1;
    }

    drawPauseScreen(ctx) {
      ctx.fillStyle = 'rgba(5, 6, 10, 0.7)';
      ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('PAUSED', this.screenWidth / 2, this.screenHeight / 2 - 20);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Press [P] or tap to resume', this.screenWidth / 2, this.screenHeight / 2 + 20);
    }

    drawGameOverScreen(ctx) {
      ctx.fillStyle = 'rgba(20, 5, 5, 0.85)';
      ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);
      ctx.textAlign = 'center';
      ctx.font = 'bold 36px serif';
      ctx.fillStyle = '#ef4444';
      ctx.fillText('VESSEL DISSOLVED', this.screenWidth / 2, this.screenHeight / 2 - 30);
      ctx.font = '15px monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('Tap or press [JUMP] to respawn at Checkpoint', this.screenWidth / 2, this.screenHeight / 2 + 20);
    }

    drawVictoryScreen(ctx) {
      ctx.fillStyle = 'rgba(3, 15, 20, 0.9)';
      ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);
      ctx.textAlign = 'center';

      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 38px serif';
      ctx.fillText('CRUCIBLE PURIFIED', this.screenWidth / 2, 160);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '16px sans-serif';
      ctx.fillText('Lord Malakor has fallen. The toxic vitriol fountain runs clear.', this.screenWidth / 2, 200);

      // Stats
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(this.screenWidth / 2 - 180, 230, 360, 110);
      ctx.strokeStyle = '#34d399';
      ctx.strokeRect(this.screenWidth / 2 - 180, 230, 360, 110);

      const mins = Math.floor(this.gameTime / 60);
      const secs = Math.floor(this.gameTime % 60);
      const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

      ctx.font = '13px monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(`CLEAR TIME:      ${timeStr}`, this.screenWidth / 2, 262);
      ctx.fillText(`ENEMIES SLAIN:   ${this.enemiesSlain}`, this.screenWidth / 2, 290);
      ctx.fillText(`HEALTH REMAINING: ${this.player.hp} / ${this.player.maxHp}`, this.screenWidth / 2, 318);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('▶ TAP OR PRESS [JUMP] TO PLAY AGAIN', this.screenWidth / 2, 400);
    }
  }

  // --- START GAME ON LOAD ---
  window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.start();
  });

})();
