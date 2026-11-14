import {AudioBufferSource, BufferTarget, CanvasSource, Output, Quality, VideoSample, VideoSampleSource, WebMOutputFormat} from 'mediabunny';
import {totalTime} from './film-timeline.mjs';

// Capture live measurements on wall-clock time; do not stretch a fast offline
// export's few seconds of telemetry into the whole film.
export async function renderFilm({canvas, shots, audio, renderAt, onProgress, signal, realtime = true}) {
  if (!('VideoEncoder' in globalThis) || !('AudioEncoder' in globalThis)) {
    throw new Error('此瀏覽器不支援影片輸出，請使用新版桌面 Chrome 或 Edge。');
  }
  signal.throwIfAborted();
  const target = new BufferTarget();
  const output = new Output({format:new WebMOutputFormat(), target});
  /** @type {import('mediabunny').VideoEncodingConfig} */
  const encoding = {codec:'vp8', quality:new Quality({bitrate:6_000_000}), latencyMode:'quality'};
  const video = realtime ? new VideoSampleSource(encoding) : new CanvasSource(canvas, encoding);
  const sound = new AudioBufferSource({codec:'opus', quality:new Quality({bitrate:128_000})});
  output.addVideoTrack(video, realtime ? {} : {frameRate:30});
  output.addAudioTrack(sound);
  const abort = () => { void output.cancel().catch(() => {}); };
  signal.addEventListener('abort',abort,{once:true});
  try {
    await output.start();
    signal.throwIfAborted();
    const audioDone = sound.add(audio).then(() => sound.close());
    /** @type {{failure: {error: unknown} | null}} */
    const audioState = {failure:null};
    void audioDone.catch(error => { audioState.failure = {error}; });
    const duration = totalTime(shots);
    const check = () => {
      signal.throwIfAborted();
      if (audioState.failure) throw audioState.failure.error;
    };
    if (video instanceof VideoSampleSource) {
      const started = performance.now();
      let pending = null;
      let time = 0;
      try {
        while (time < duration) {
          check();
          renderAt(time);
          const previous = pending;
          // Snapshot before awaiting the encoder: newer live measurements must
          // never replace the pixels belonging to an earlier timestamp.
          pending = new VideoSample(canvas, {timestamp:time});
          if (previous) {
            previous.setDuration(time - previous.timestamp);
            try { await video.add(previous); }
            finally { previous.close(); }
          }
          check();
          onProgress(time / duration);
          const wait = started + Math.min(duration, time + 1 / 30) * 1000 - performance.now();
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          // Skip missed sampling slots instead of using present-day data to
          // backfill the past. At most two immutable frames are held at once.
          time = (performance.now() - started) / 1000;
        }
        check();
        if (pending) {
          pending.setDuration(duration - pending.timestamp);
          await video.add(pending);
        }
        check();
        onProgress(1);
      } finally {
        pending?.close();
      }
    } else {
      const frames = Math.ceil(duration * 30);
      for (let i = 0; i < frames; i++) {
        check();
        renderAt(i / 30);
        await video.add(i / 30, Math.min(1 / 30, duration - i / 30));
        check();
        onProgress((i + 1) / frames);
        if (i % 5 === 0) await new Promise(resolve => setTimeout(resolve,0));
      }
    }
    video.close();
    await audioDone;
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    return new Blob([target.buffer],{type:'video/webm'});
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort',abort);
  }
}
