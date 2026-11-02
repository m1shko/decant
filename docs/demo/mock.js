// Stand-in for the Electron preload so the interface can be rendered in a plain
// browser for README screenshots: docs/demo/index.html?scene=audio|video|playlist|history
(function () {
  const scene = new URLSearchParams(location.search).get('scene') || 'audio';

  const art = (a, b, label) =>
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><text x="12" y="76" font-family="Helvetica" font-weight="700" font-size="16" fill="white" opacity=".85">${label}</text></svg>`,
    );

  const video = {
    type: 'video',
    url: 'https://www.youtube.com/watch?v=demo',
    title: 'Sunset Drive — synthwave mix for coding (1 hour)',
    uploader: 'Neon Avenue',
    duration: 3725,
    thumbnail: art('#ff7a59', '#7b2ff7', 'SUNSET DRIVE'),
    source: 'Youtube',
    hasVideo: true,
    heights: [2160, 1440, 1080, 720, 480, 360],
  };

  const playlist = {
    type: 'playlist',
    title: 'Sunday chill',
    uploader: 'Lea M.',
    source: 'YoutubeTab',
    entries: [
      ['Misty morning', 214],
      ['Coffee by the harbour', 187],
      ['Lisbon rooftops', 243],
      ['Low tide', 199],
      ['Last tram home', 228],
      ['October light', 176],
    ].map(([title, duration], i) => ({
      url: `https://www.youtube.com/watch?v=demo${i}`,
      title,
      duration,
      uploader: 'Lea M.',
      thumbnail: art(['#2bc0e4', '#f7971e', '#ee0979', '#56ab2f', '#614385', '#f857a6'][i], '#1d1d3a', ''),
    })),
  };

  const jobs = [
    {
      id: 'j1',
      status: 'downloading',
      percent: 62,
      speed: 4.2 * 1024 * 1024,
      eta: 7,
      kind: 'video',
      format: 'mp4',
      quality: '1080',
      title: 'Quick recipe: lemon pasta in 10 minutes',
      thumbnail: art('#f9d423', '#ff4e50', 'RECIPE'),
    },
    {
      id: 'j2',
      status: 'processing',
      percent: 100,
      kind: 'audio',
      format: 'mp3',
      quality: '320',
      title: 'Acoustic live session — “Quiet Days”',
      thumbnail: art('#43cea2', '#185a9d', 'LIVE'),
    },
    {
      id: 'j3',
      status: 'done',
      percent: 100,
      kind: 'video',
      format: 'mp4',
      quality: 'best',
      title: 'My cat sees snow for the first time',
      thumbnail: art('#e0eafc', '#7f8fa6', 'TIKTOK'),
      filePath: '/demo.mp4',
    },
  ];

  const now = Date.now();
  const history = [
    ['My cat sees snow for the first time', 'video', 'mp4', 'best', 0.2, '#e0eafc', '#7f8fa6'],
    ['Sunset Drive — synthwave mix for coding', 'audio', 'mp3', '320', 26, '#ff7a59', '#7b2ff7'],
    ['How to tune your road bike', 'video', 'mp4', '1080', 50, '#56ab2f', '#a8e063'],
    ['Podcast — Episode 42: sleep', 'audio', 'm4a', null, 74, '#614385', '#516395'],
    ['Reel: sunset in Biarritz', 'video', 'mp4', '720', 120, '#f857a6', '#ff5858'],
    ['Piano session — improvisation', 'audio', 'flac', null, 170, '#232526', '#414345'],
  ].map(([title, kind, format, quality, hours, a, b], i) => ({
    id: `h${i}`,
    title,
    kind,
    format,
    quality,
    thumbnail: art(a, b, ''),
    filePath: i === 4 ? null : `/demo${i}`,
    url: 'https://example.com',
    date: now - hours * 3600 * 1000,
  }));

  const noop = () => {};
  const listen = () => noop;
  window.siphon = {
    platform: 'demo',
    probe: async (input) => (scene === 'playlist' ? playlist : video),
    settings: {
      get: async () => ({
        outputDir: '/Users/you/Downloads',
        kind: scene === 'video' ? 'video' : 'audio',
        audioFormat: 'mp3',
        audioQuality: '320',
        videoQuality: '1080',
        cookiesBrowser: '',
      }),
      set: async () => {},
    },
    folder: { choose: async () => null, open: noop },
    queue: {
      list: async () => (scene === 'history' ? [] : jobs),
      add: noop,
      cancel: noop,
      retry: noop,
      remove: noop,
      clear: noop,
      onUpdate: listen,
      onRemoved: listen,
    },
    history: { list: async () => history, remove: async () => history, clear: async () => [], onUpdate: listen },
    file: { exists: async (f) => Boolean(f), reveal: noop, open: noop },
    openLink: noop,
    readClipboard: async () =>
      scene === 'history' ? '' : scene === 'playlist' ? 'https://www.youtube.com/playlist?list=demo' : 'https://www.youtube.com/watch?v=demo',
    engine: { version: async () => '2026.10.22', update: async () => '2026.10.22', onVersion: listen },
  };

  window.addEventListener('load', () => {
    setTimeout(() => {
      if (scene === 'history') document.querySelector('[data-tab="history"]').click();
      if (scene === 'video') {
        const trim = document.querySelector('.trim input[type="checkbox"]');
        trim.click();
        setTimeout(() => {
          const [start, end] = document.querySelectorAll('.trim input[type="text"]');
          start.value = '12:30';
          end.value = '16:05';
          start.dispatchEvent(new Event('input'));
        }, 50);
      }
      document.activeElement?.blur();
    }, 150);
  });
})();
