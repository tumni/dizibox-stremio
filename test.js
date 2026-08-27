const { findContent } = require('./search');
const { getVideoStream } = require('./scraper');

(async () => {
    console.log('=== Dizibox Addon Test ===\n');

    // Test 1: Series - Wednesday S01E01
    console.log('Test 1: Wednesday S01E01 (tt3526078)');
    try {
        const content = await findContent('series', 'tt3526078', '1', '1');
        console.log('✅ Content found:', content.url);
        const streams = await getVideoStream(content.url, content.title);
        console.log('✅ Streams:', streams.streams.length);
        streams.streams.forEach(s => {
            console.log('  -', s.name, '|', s.url?.substring(0, 60));
            if (s.subtitles) console.log('    Subtitles:', s.subtitles.map(sub => sub.lang).join(', '));
        });
    } catch(e) {
        console.log('❌ Error:', e.message);
    }

    console.log('');

    // Test 2: Series - Star Trek SNW  
    console.log('Test 2: Star Trek Strange New Worlds S04E06 (tt12327578)');
    try {
        const content = await findContent('series', 'tt12327578', '4', '6');
        console.log('✅ Content found:', content.url);
        const streams = await getVideoStream(content.url, content.title);
        console.log('✅ Streams:', streams.streams.length);
        streams.streams.forEach(s => {
            console.log('  -', s.name, '|', s.url?.substring(0, 60));
        });
    } catch(e) {
        console.log('❌ Error:', e.message);
    }
})();
