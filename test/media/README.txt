Vídeos de teste usados por test/mock-provider.mjs. Para gerar de novo:

ffmpeg -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 12 -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 50 -c:a aac -b:a 96k -f hls -hls_time 2 -hls_list_size 0 -hls_segment_filename 'hls/seg%d.ts' hls/index.m3u8
sed -i '/#EXT-X-ENDLIST/d' hls/index.m3u8
ffmpeg -f lavfi -i testsrc=size=640x360:rate=25 -f lavfi -i sine=frequency=660:sample_rate=48000 -t 30 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -f mpegts live.ts
ffmpeg -f lavfi -i smptebars=size=640x360:rate=25 -f lavfi -i sine=frequency=330:sample_rate=48000 -t 60 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart movie.mp4
