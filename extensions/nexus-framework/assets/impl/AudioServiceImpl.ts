import { AudioClip, AudioSource, director, game, Node } from 'cc';
import { Nexus } from '../core/Nexus';
import { IAudioService } from '../services/contracts';

/** localStorage key 常量 */
const STORAGE_MUSIC_VOLUME  = 'audio_music_volume';
const STORAGE_SFX_VOLUME    = 'audio_sfx_volume';
const STORAGE_MUSIC_ENABLED = 'audio_music_enabled';
const STORAGE_SFX_ENABLED   = 'audio_sfx_enabled';

/**
 * 基于 AudioSource 的音频管理实现。
 *
 * 架构：
 *   - 创建一个跨场景持久节点 [NexusAudio]
 *   - 挂一个 AudioSource 专用于背景音乐（loop）
 *   - 挂 SFX_POOL_SIZE 个 AudioSource 组成音效池（playOneShot，自动复用空闲通道）
 *
 * 音量与开关状态通过 Nexus.storage 持久化到 localStorage，onBoot 时自动恢复。
 */
export class AudioServiceImpl extends IAudioService {

    private static readonly SFX_POOL_SIZE = 6;

    private _musicVolume = 1;
    private _sfxVolume   = 1;
    private _musicEnabled = true;
    private _sfxEnabled   = true;

    private _audioNode:    Node        | null = null;
    private _musicSource:  AudioSource | null = null;
    private _sfxSources:   AudioSource[]      = [];
    /** 已加载的 AudioClip 缓存，onBundleExit 时释放非 common 的 clip */
    private readonly _clipCache = new Map<string, AudioClip>();

    /** 创建持久音频节点，并从 localStorage 恢复音量与开关状态。 */
    async onBoot(): Promise<void> {
        // 从 localStorage 恢复状态
        this._musicVolume  = Nexus.storage.get<number>(STORAGE_MUSIC_VOLUME, 1)!;
        this._sfxVolume    = Nexus.storage.get<number>(STORAGE_SFX_VOLUME, 1)!;
        this._musicEnabled = Nexus.storage.get<boolean>(STORAGE_MUSIC_ENABLED, true)!;
        this._sfxEnabled   = Nexus.storage.get<boolean>(STORAGE_SFX_ENABLED, true)!;

        this._audioNode = new Node('[NexusAudio]');

        // 添加到当前场景，再设为持久节点（CC3 要求）
        director.getScene()?.addChild(this._audioNode);
        game.addPersistRootNode(this._audioNode);

        // 背景音乐通道
        this._musicSource = this._audioNode.addComponent(AudioSource);
        this._musicSource.loop   = true;
        this._musicSource.volume = this._musicVolume;

        // 音效池
        for (let i = 0; i < AudioServiceImpl.SFX_POOL_SIZE; i++) {
            const src = this._audioNode.addComponent(AudioSource);
            src.loop   = false;
            src.volume = this._sfxVolume;
            this._sfxSources.push(src);
        }
    }

    /** 播放背景音乐，自动从当前 bundle 查找，失败 fallback 到 common。 */
    async playMusic(path: string, loop = true): Promise<void> {
        if (!this._musicEnabled || !this._musicSource) return;
        const clip = await this.loadClip(path);
        if (!clip) return;
        this._musicSource.clip   = clip;
        this._musicSource.loop   = loop;
        this._musicSource.volume = this._musicVolume;
        this._musicSource.play();
    }

    /** 停止当前背景音乐。 */
    stopMusic(): void {
        this._musicSource?.stop();
    }

    /** 淡出当前 BGM 再淡入新 BGM。 */
    async playMusicFade(path: string, fadeDuration = 0.5, loop = true): Promise<void> {
        if (!this._musicEnabled || !this._musicSource) return;
        const clip = await this.loadClip(path);
        if (!clip) return;
        const src = this._musicSource;
        // 淡出旧音乐
        if (src.playing) {
            await this._fadeVolume(src, src.volume, 0, fadeDuration * 1000);
            src.stop();
        }
        // 淡入新音乐
        src.clip   = clip;
        src.loop   = loop;
        src.volume = 0;
        src.play();
        await this._fadeVolume(src, 0, this._musicVolume, fadeDuration * 1000);
    }

    /** 淡出并停止当前背景音乐。 */
    async stopMusicFade(fadeDuration = 0.5): Promise<void> {
        const src = this._musicSource;
        if (!src?.playing) return;
        const target = this._musicVolume;
        await this._fadeVolume(src, src.volume, 0, fadeDuration * 1000);
        src.stop();
        src.volume = target; // 恢复音量，避免影响下次播放
    }

    /** 播放音效，自动从当前 bundle 查找，失败 fallback 到 common。 */
    async playSfx(path: string): Promise<void> {
        if (!this._sfxEnabled) return;
        const clip = await this.loadClip(path);
        if (!clip) return;
        const src = this._sfxSources.find(s => !s.playing) ?? this._sfxSources[0];
        src.volume = this._sfxVolume;
        src.playOneShot(clip);
    }

    /** 播放指定 bundle 的背景音乐。 */
    async playMusicByBundle(bundle: string, path: string, loop = true): Promise<void> {
        if (!this._musicEnabled || !this._musicSource) return;
        try {
            const clip = await Nexus.asset.load<AudioClip>(bundle, path, AudioClip);
            this._musicSource.clip   = clip;
            this._musicSource.loop   = loop;
            this._musicSource.volume = this._musicVolume;
            this._musicSource.play();
        } catch {
            console.error(`[Nexus][Audio] Failed to load music: ${bundle}/${path}`);
        }
    }

    /** 播放指定 bundle 的音效。 */
    async playSfxByBundle(bundle: string, path: string): Promise<void> {
        if (!this._sfxEnabled) return;
        try {
            const clip = await Nexus.asset.load<AudioClip>(bundle, path, AudioClip);
            const src = this._sfxSources.find(s => !s.playing) ?? this._sfxSources[0];
            src.volume = this._sfxVolume;
            src.playOneShot(clip);
        } catch {
            console.error(`[Nexus][Audio] Failed to load sfx: ${bundle}/${path}`);
        }
    }

    /** 设置背景音乐音量并持久化。 */
    setMusicVolume(vol: number): void {
        this._musicVolume = this.clamp01(vol);
        if (this._musicSource) this._musicSource.volume = this._musicVolume;
        Nexus.storage.set(STORAGE_MUSIC_VOLUME, this._musicVolume);
    }

    /** 设置音效音量并持久化。 */
    setSfxVolume(vol: number): void {
        this._sfxVolume = this.clamp01(vol);
        for (const src of this._sfxSources) src.volume = this._sfxVolume;
        Nexus.storage.set(STORAGE_SFX_VOLUME, this._sfxVolume);
    }

    /** 获取当前背景音乐音量。 */
    getMusicVolume(): number { return this._musicVolume; }

    /** 获取当前音效音量。 */
    getSfxVolume(): number { return this._sfxVolume; }

    /** 开关背景音乐并持久化；关闭时会立即停止播放。 */
    setMusicEnabled(on: boolean): void {
        this._musicEnabled = on;
        Nexus.storage.set(STORAGE_MUSIC_ENABLED, on);
        if (!on) this.stopMusic();
    }

    /** 开关音效播放并持久化。 */
    setSfxEnabled(on: boolean): void {
        this._sfxEnabled = on;
        Nexus.storage.set(STORAGE_SFX_ENABLED, on);
    }

    /** 背景音乐是否开启。 */
    isMusicEnabled(): boolean { return this._musicEnabled; }

    /** 音效是否开启。 */
    isSfxEnabled(): boolean { return this._sfxEnabled; }

    /** 背景音乐是否正在播放。 */
    isMusicPlaying(): boolean {
        return !!this._musicSource?.playing;
    }

    /** 暂停全部音频通道。 */
    pauseAll(): void {
        this._musicSource?.pause();
        for (const src of this._sfxSources) src.pause();
    }

    /** 恢复全部音频通道。 */
    resumeAll(): void {
        if (this._musicEnabled && this._musicSource?.clip) this._musicSource.play();
        for (const src of this._sfxSources) {
            if (src.clip) src.play();
        }
    }

    /** 销毁持久音频节点并清空引用。 */
    async onDestroy(): Promise<void> {
        this.stopMusic();
        // 释放所有缓存的 AudioClip
        for (const clip of this._clipCache.values()) {
            clip.decRef();
        }
        this._clipCache.clear();
        if (this._audioNode) {
            game.removePersistRootNode(this._audioNode);
            this._audioNode.destroy();
            this._audioNode = null;
        }
        this._musicSource = null;
        this._sfxSources  = [];
    }

    /** Bundle 退出时释放该 Bundle 加载的 AudioClip 缓存 */
    async onBundleExit(bundleName: string): Promise<void> {
        const prefix = `${bundleName}:`;
        for (const [key, clip] of this._clipCache) {
            if (key.startsWith(prefix)) {
                clip.decRef();
                this._clipCache.delete(key);
            }
        }
        // 如果当前音乐来自该 bundle，停止播放
        if (this._musicSource?.playing) {
            const musicClip = this._musicSource.clip;
            if (musicClip && !this._clipCache.has(`common:${musicClip.name}`)) {
                this._musicSource.stop();
                this._musicSource.clip = null;
            }
        }
    }

    /** 先从当前 bundle 加载 AudioClip，失败则 fallback 到 common，都失败返回 null。 */
    private async loadClip(path: string): Promise<AudioClip | null> {
        const current = Nexus.bundle.current;
        // 先查缓存
        if (current) {
            const cacheKey = `${current}:${path}`;
            const cached = this._clipCache.get(cacheKey);
            if (cached) return cached;
        }
        const commonKey = `common:${path}`;
        const commonCached = this._clipCache.get(commonKey);
        if (commonCached) return commonCached;

        // 加载并缓存
        if (current) {
            try {
                const clip = await Nexus.asset.load<AudioClip>(current, path, AudioClip);
                clip.addRef();
                this._clipCache.set(`${current}:${path}`, clip);
                return clip;
            } catch {
                // 当前 bundle 加载失败，尝试 common
            }
        }
        try {
            const clip = await Nexus.asset.load<AudioClip>('common', path, AudioClip);
            clip.addRef();
            this._clipCache.set(commonKey, clip);
            return clip;
        } catch {
            // common 也失败
        }
        console.error(`[Nexus][Audio] Failed to load audio: ${path} (tried: ${current || 'none'}, common)`);
        return null;
    }

    /** 将数值限制在 0 到 1 之间。 */
    private clamp01(v: number): number {
        return Math.min(1, Math.max(0, v));
    }

    /** 在 durationMs 内将 AudioSource 的 volume 从 from 线性过渡到 to。 */
    private _fadeVolume(src: AudioSource, from: number, to: number, durationMs: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const STEPS    = 20;
            const stepMs   = durationMs / STEPS;
            const stepDelta = (to - from) / STEPS;
            src.volume = from;
            let step = 0;
            const timer = setInterval(() => {
                step++;
                src.volume = this.clamp01(from + stepDelta * step);
                if (step >= STEPS) {
                    clearInterval(timer);
                    src.volume = to;
                    resolve();
                }
            }, stepMs);
        });
    }
}
