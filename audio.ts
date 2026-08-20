class SoundEffects {
    private audioCtx: AudioContext | null = null;
    private initialized = false;

    init() {
        if (!this.initialized) {
            this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.initialized = true;
        }
    }

    playDrawNumber() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, this.audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.5, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.1);
        } catch (e) { console.error(e); }
    }

    playWinner() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
            notes.forEach((freq, i) => {
                const osc = this.audioCtx.createOscillator();
                const gainNode = this.audioCtx.createGain();
                osc.connect(gainNode);
                gainNode.connect(this.audioCtx.destination);
                osc.type = 'triangle';
                osc.frequency.value = freq;
                gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime + i * 0.1);
                gainNode.gain.linearRampToValueAtTime(0.3, this.audioCtx.currentTime + i * 0.1 + 0.05);
                gainNode.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + i * 0.1 + 0.3);
                osc.start(this.audioCtx.currentTime + i * 0.1);
                osc.stop(this.audioCtx.currentTime + i * 0.1 + 0.3);
            });
        } catch (e) { console.error(e); }
    }

    playBid() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, this.audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.1);
        } catch (e) { console.error(e); }
    }

    playSold() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(50, this.audioCtx.currentTime + 0.2);
            gainNode.gain.setValueAtTime(0.5, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.2);
        } catch (e) { console.error(e); }
    }

    playClick() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, this.audioCtx.currentTime + 0.05);
            gainNode.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.05);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.05);
        } catch (e) { console.error(e); }
    }

    playError() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.2);
            gainNode.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.2);
        } catch (e) { console.error(e); }
    }

    playSuccess() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
            osc.frequency.linearRampToValueAtTime(900, this.audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0, this.audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.2, this.audioCtx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.15);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.15);
        } catch (e) { console.error(e); }
    }

    playReset() {
        this.init();
        if (!this.audioCtx) return;
        try {
            const osc = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();
            osc.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.3);
            gainNode.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);
            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.3);
        } catch (e) { console.error(e); }
    }
}

export const sounds = new SoundEffects();
