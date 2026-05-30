# KikiRecorder - Cấu trúc và đặc tả chức năng

Tài liệu này mô tả cấu trúc hiện tại của codebase và các yêu cầu chức năng cần giữ đồng bộ sau mỗi lần cập nhật. Phần **Toolbox khi quay** bên dưới là đặc tả mục tiêu để AI/dev làm lại đúng theo yêu cầu UI/UX mới.

## Tổng quan

KikiRecorder là ứng dụng desktop ghi màn hình đa nền tảng dùng Electron, React, Tailwind CSS và FFmpeg. Ứng dụng ưu tiên quyền riêng tư: lưu file cục bộ, không đăng nhập, không telemetry, không watermark bắt buộc. Giao diện cần hỗ trợ English và Tiếng Việt UTF-8.

## Cấu trúc thư mục

```text
.
|-- index.html
|-- package.json
|-- scripts/
|   `-- start-electron-dev.cjs
|-- src/
|   |-- main/
|   |   |-- ffmpeg.ts
|   |   |-- index.ts
|   |   |-- paths.ts
|   |   `-- storage.ts
|   |-- preload/
|   |   `-- index.ts
|   |-- renderer/
|   |   |-- App.tsx
|   |   |-- components/
|   |   |   |-- RecordingSurfaceApp.tsx
|   |   |   |-- RecordingToolboxApp.tsx
|   |   |   `-- RegionOverlayApp.tsx
|   |   |-- defaults.ts
|   |   |-- i18n.tsx
|   |   |-- lib/
|   |   |-- main.tsx
|   |   `-- styles.css
|   `-- shared/
|       `-- types.ts
|-- README.md
`-- SOFTWARE_STRUCTURE.md
```

## Thành phần chính

- `src/main/index.ts`: Electron main process, tạo cửa sổ chính, overlay chọn vùng, toolbox khi quay, surface vẽ trong suốt, đăng ký IPC, lấy nguồn màn hình/cửa sổ, hotkey, lịch ghi và quyền hệ thống.
- `src/main/ffmpeg.ts`: chạy FFmpeg để chuyển WebM ghi thô sang MP4 mặc định và export MP4, WEBM, GIF, AVI, MOV.
- `src/preload/index.ts`: bridge IPC an toàn giữa renderer và main process, gồm API chọn vùng desktop, lưu video và điều khiển recording overlay/toolbox.
- `src/renderer/App.tsx`: state chính của UI, start/stop/pause recorder, nhận event từ toolbox/surface, quản lý thư viện, lịch ghi và settings.
- `src/renderer/components/RegionOverlayApp.tsx`: overlay trong suốt phủ màn hình để kéo chọn, di chuyển và resize vùng ghi trước khi bắt đầu.
- `src/renderer/components/RecordingToolboxApp.tsx`: cửa sổ toolbox riêng khi quay. File này cần được làm lại theo đặc tả Toolbox bên dưới.
- `src/renderer/components/RecordingSurfaceApp.tsx`: surface trong suốt chỉ phục vụ vẽ trực tiếp và hiển thị annotation trên desktop.
- `src/renderer/components/RecordingStage.tsx`: preview nhỏ trong app; hỗ trợ nhập text inline ngay tại vị trí click, kéo text bằng công cụ Select, và kéo khung webcam overlay đến vị trí bất kỳ trong preview.
- `src/renderer/lib/recorder/RecorderEngine.ts`: lấy stream màn hình/webcam/audio, chạy MediaRecorder, điều khiển pause/resume/mute và lưu file.
- `src/renderer/lib/recorder/LivePreviewEngine.ts`: chạy live preview nhẹ trước khi quay, lấy stream màn hình/cửa sổ/webcam đã chọn và render bằng `CanvasCompositor` nhưng không bật MediaRecorder/FFmpeg.
- `src/renderer/lib/recorder/CanvasCompositor.ts`: render màn hình, webcam overlay, annotation, blur/pixelate, spotlight, smooth zoom và click highlight vào canvas ghi hình; không vẽ dòng gợi ý phím tắt lên preview/video. Blur/pixelate phải được render trước các nét vẽ màu để không tạo bóng màu cũ của bút.
- `src/renderer/lib/media/AudioMixer.ts`: trộn âm thanh hệ thống và micro, hỗ trợ mute/unmute trong lúc quay.
- `src/renderer/i18n.tsx`: ngôn ngữ English và Tiếng Việt UTF-8.

## Chức năng chính của phần mềm

- Ghi toàn màn hình, cửa sổ ứng dụng, vùng chọn desktop và webcam-only. Chế độ tab trình duyệt đã được bỏ khỏi UI chế độ để tránh nhầm luồng capture.
- Live preview trước khi quay: khi chọn màn hình/cửa sổ/webcam, preview trong app phải hiện ngay nguồn đó để người dùng vẽ, thêm text inline, đặt webcam overlay và kiểm tra bố cục trước khi bấm quay. Annotation vẽ trước khi bấm quay phải được giữ lại để render vào video.
- Chọn vùng ghi bằng overlay toàn desktop: kéo tạo vùng ở bất cứ vị trí nào trên màn hình, hiện kích thước, có thể di chuyển/resize trước khi quay.
- Khi chuyển từ `Vùng chọn` sang `Màn hình`, `Cửa sổ` hoặc `Webcam`, app phải xóa `captureArea/captureRegion`; `CanvasCompositor` chỉ crop khi mode hiện tại là `area`.
- File đầu ra mặc định là MP4. Nội bộ có thể ghi WebM bằng MediaRecorder rồi chuyển MP4 bằng FFmpeg; nếu FFmpeg lỗi thì giữ WebM fallback và báo lỗi rõ.
- Ghi system audio, microphone hoặc cả hai; có thể bật/tắt mic/system audio trong lúc quay nếu track đã được capture.
- Webcam picture-in-picture, tùy chỉnh hình chữ nhật/hình tròn, kích thước, vị trí, background blur hoặc virtual background cơ bản. Có thể kéo thả webcam overlay trong preview bằng công cụ Select; vị trí mới được lưu vào settings và dùng khi ghi video.
- Luồng preview/recording phải hạn chế restart stream không cần thiết; các thay đổi nhẹ như style, annotation, zoom, spotlight và vị trí webcam chỉ update settings/compositor. Kéo webcam overlay được throttle bằng `requestAnimationFrame` để giảm lag.
- Vẽ và chú thích thời gian thực: pen, highlighter, text, arrow, line, rectangle, circle, step marker, eraser, undo/redo, blur, pixelate.
- Smooth zoom, spotlight quanh con trỏ và highlight click chuột trong lúc quay.
- Pause/resume/restart/stop, countdown timer, auto-stop timer, hotkey tùy chỉnh.
- Screenshot kèm annotation.
- Thư viện bản ghi cục bộ, lịch ghi tự động, editor/export bằng FFmpeg.
- Dark/light/system theme.

## Luồng ghi hình mục tiêu

1. Khi app ở tab ghi hình và trạng thái `idle`, `LivePreviewEngine` tự mở preview nguồn đang chọn nếu có `sourceId` hoặc đang ở mode webcam.
2. Người dùng có thể vẽ, thêm text, blur/pixelate, kéo webcam overlay và xem trước bố cục ngay trong preview nhỏ trước khi quay. Các annotation này không bị reset khi bấm `Bắt đầu`.
3. Người dùng bấm `Bắt đầu`.
4. App dừng live preview nhẹ để nhường stream cho recorder thật, rồi khóa trạng thái start bằng `preparing` để chống double-click/hotkey lặp.
5. Nếu chế độ là `area`, mở `RegionOverlayApp` để chọn vùng. Chỉ được có một overlay chọn vùng tại một thời điểm.
6. Sau khi có source/vùng ghi, renderer gọi `RecorderEngine.start()`.
7. Engine lấy stream qua `desktopCapturer`/`getDisplayMedia`, tạo compositor, audio mixer và MediaRecorder.
8. Khi recording thật sự vào trạng thái `recording` hoặc `paused`, main process mở một cửa sổ `RecordingToolboxApp` nhỏ ở phía trên màn hình đang quay.
9. Surface vẽ `RecordingSurfaceApp` không mở sẵn toàn màn hình. Nó chỉ mở khi người dùng bật công cụ vẽ hoặc khi đã có annotation cần hiển thị.
10. Toolbox gửi event điều khiển về App qua IPC: pause, resume, stop, tool, undo, redo, zoom, spotlight, mic/system audio.
11. Surface gửi pointer/text/wheel event về App khi đang ở chế độ tương tác vẽ.
12. `CanvasCompositor` render annotation/effect vào video, bao gồm cả annotation người dùng đã chuẩn bị trong live preview trước khi quay.
13. Khi stop, app phải đóng toàn bộ toolbox/surface, gọi `requestData()`, dừng recorder, kiểm tra chunk, lưu WebM tạm và chuyển MP4 bằng FFmpeg.
14. Sau khi stop/lưu xong, annotation/redo/step marker phải được reset đồng bộ cả state lẫn ref để phiên sau không mang nét vẽ từ phiên trước sang.

## Đặc tả làm lại Toolbox khi quay

### Mục tiêu

Toolbox là thanh công cụ nổi xuất hiện khi bắt đầu quay, dùng để điều khiển ghi hình và vẽ/chú thích trực tiếp trên màn hình đang quay. Đây phải là **một cửa sổ riêng nhỏ gọn**, không phải layout cũ của app chính, không phải preview panel, không phải overlay lớn che toàn màn hình.

Các lỗi cần tránh:

- Không mở nhiều cửa sổ khi bấm `Bắt đầu`.
- Không làm app chính hoặc toolbox phóng to/always-on-top che hết ứng dụng khác.
- Không để toolbox bị kẹt sau khi stop hoặc crash.
- Không mở surface vẽ khi chưa cần, tránh lag và lỗi click vào ứng dụng khác.
- Không dùng lại giao diện toolbox cũ dạng panel lớn.

### Cửa sổ Toolbox

- Tạo bằng Electron `BrowserWindow` riêng, frameless, transparent, always-on-top ở mức vừa đủ.
- Kích thước mặc định đề xuất: rộng 620-760 px, cao 52-64 px. Khi mở panel công cụ vẽ có thể tăng chiều cao nhưng vẫn là một cụm UI gọn, không full-screen.
- Vị trí mặc định: top-center của màn hình/vùng đang quay, cách mép trên khoảng 16-24 px.
- Có thể kéo thả bằng grip/menu bên trái.
- Có thể ẩn bằng nút `X` hoặc hotkey. Ẩn chỉ ẩn toolbox, không dừng quay. Khi stop, toolbox tự đóng hoàn toàn.
- Nút minimize phải thu toolbox thành một pill nhỏ vẫn nhìn thấy được, có grip riêng để kéo và nút `Mở lại/Restore` riêng để bung toolbox. Không được đặt nút restore trong vùng `nativeDrag`, vì Electron sẽ nuốt click và người dùng không mở lại được.
- Có thể chỉnh opacity/nền trong suốt nếu cần, nhưng mặc định là dark glass giống ảnh tham chiếu: nền xám đen, icon sáng, active state màu tím/xanh lá.
- Không dùng sidebar, không dùng card lớn, không dùng layout màn hình chính.

### Bố cục thanh chính

Thứ tự từ trái sang phải:

1. Grip/menu `⋮⋮` để kéo thanh và mở More tools.
2. Nút Pause/Resume với icon `||` hoặc `▶`, kèm text ngắn `Pause`/`Resume`.
3. Nút Stop với icon hình vuông, hiển thị hotkey nếu có, ví dụ `Stop (F8)`.
4. Timer dạng `00:00:05`, có chấm đỏ `REC` khi đang quay.
5. Nút Drawing Tool icon bút chì. Click để mở/đóng panel công cụ vẽ.
6. Nút Add Element để thêm nhanh text, shape hoặc arrow.
7. Undo và Redo.
8. Nút Spotlight/Eye bật chế độ làm tối màn hình, chỉ sáng vùng quanh con trỏ.
9. Toggle Mic với trạng thái active/disabled rõ ràng.
10. Toggle System Audio với trạng thái active/disabled rõ ràng.
11. Nút `X` để ẩn toolbox.

### Panel công cụ vẽ đầy đủ

Panel mở từ nút bút chì, nằm dính dưới hoặc bên cạnh thanh chính, cùng style dark glass, không mở thành cửa sổ lớn. Panel cần có:

- Freehand Pen: chọn màu, độ dày, opacity.
- Highlighter: màu, độ dày, opacity thấp.
- Text: font, kích thước, màu, bold, italic.
- Shapes: arrow, line, rectangle, circle.
- Step marker: đánh số 1, 2, 3... tự động tăng, có reset.
- Blur/Pixelate: kéo vùng chữ nhật hoặc freeform để làm mờ/pixelate ngay.
- Blur/Pixelate phải bỏ qua vùng kéo quá nhỏ, clamp vùng trong canvas và không vẽ viền trắng vào video cuối.
- Eraser: xóa nét/vùng annotation.
- Undo/Redo và Clear all.
- Smooth Zoom: zoom in/out, slider hoặc nút `+`/`-`, clamp 1x-4x.
- Highlight clicks: bật/tắt và chọn màu vòng click.
- Spotlight mode: bật/tắt và chỉnh bán kính nếu cần.

### Hành vi bật/tắt công cụ

- Mặc định toolbox ở chế độ `select`, không chặn chuột desktop.
- Click vào một tool, ví dụ `pen`, sẽ bật chế độ vẽ và mở/enable `RecordingSurfaceApp`.
- Click lại chính tool đang bật sẽ tắt tool đó, quay về `select`, surface chuyển click-through để người dùng thao tác app khác.
- Annotation đã vẽ vẫn giữ trên màn hình và vẫn được render vào video sau khi tắt tool.
- Khi đổi tool, ví dụ từ `pen` sang `arrow`, active tool chuyển ngay, không cần tắt tool cũ trước.
- Wheel chuột chỉ điều khiển zoom khi focus nằm trên surface/toolbar hoặc khi chế độ zoom được bật, tránh cướp scroll của app khác.
- Text tool trong preview nhỏ của app cần cho phép click vị trí bất kỳ để thêm chữ. Dùng Select kéo text để di chuyển vị trí; không bắt buộc phải click trực tiếp trên desktop overlay.

### Recording Surface

- `RecordingSurfaceApp` là cửa sổ trong suốt riêng, không chứa toolbar.
- Surface phủ đúng màn hình/vùng đang quay, không phủ sai monitor.
- Surface chỉ nhận pointer khi active tool khác `select`.
- Khi active tool là `select`, surface phải click-through để chuột đi qua ứng dụng bên dưới.
- Khi surface mở hoặc chuyển sang tương tác, main process phải đưa toolbox lên trên cùng để các nút pause/stop/tool vẫn bấm được.
- Nếu không còn annotation và active tool là `select`, có thể đóng surface để giảm CPU.
- Surface chỉ hiển thị annotation, spotlight/click highlight nếu cần; mọi UI điều khiển nằm ở toolbox.

### Ẩn/hiện nét vẽ trên desktop

- Toolbox có nút con mắt riêng để điều khiển annotation trên màn hình đang quay.
- Mắt mở: `surfaceAnnotationsVisible = true`, `RecordingSurfaceApp` render các nét vẽ/annotation trực tiếp lên desktop.
- Mắt đóng: `surfaceAnnotationsVisible = false`, `RecordingSurfaceApp` vẫn có thể tồn tại để nhận thao tác vẽ khi cần nhưng không render annotation ra desktop.
- Nút này chỉ ẩn/hiện lớp hiển thị ngoài desktop. Preview nhỏ trong app và `CanvasCompositor` vẫn render annotation từ state chung, nên người dùng vẫn thấy nét vẽ trong preview và video vẫn giữ annotation.
- Mỗi phiên quay mới reset về mắt mở để tránh bắt đầu quay trong trạng thái ẩn ngoài ý muốn.
- IPC event: `toggle-surface-annotations`. State trong `RecordingOverlayConfig`: `surfaceAnnotationsVisible`.

### IPC và state cần chuẩn hóa

- `recording-overlay:open`: mở toolbox sau khi recorder thật sự start.
- `recording-overlay:update`: cập nhật timer, pause state, mic/system state, active tool, style tool, zoom, spotlight.
- `recording-overlay:close`: đóng toolbox và surface khi stop/restart/app close.
- `recording-overlay:event`: gửi event từ toolbox/surface về App.
- Event chọn tool dùng toggle semantics: chọn lại tool đang active thì trả về `select`.
- Cần có cleanup path trong main process: khi stop, restart, renderer crash hoặc app quit thì destroy toolbox/surface và clear reference.

### Tiêu chí nghiệm thu Toolbox

- Bấm `Bắt đầu` chỉ mở một toolbox nhỏ, không mở loạn nhiều cửa sổ.
- Toolbox hiển thị giống style ảnh tham chiếu: thanh ngang gọn, dark glass, icon rõ, timer ở giữa, nút pause/stop dễ bấm.
- App chính không bị always-on-top và không che màn hình khi đang quay.
- Bấm bút vẽ thì vẽ được trực tiếp trên desktop; bấm lại bút thì không vẽ nữa, chuột thao tác được app khác, nét vẽ vẫn còn.
- Pen, text, shape, step marker, blur, pixelate, eraser, undo/redo hoạt động trong lúc quay.
- Pause/resume/stop trên toolbox hoạt động ổn định, không lag, không crash.
- Minimize/restore hoạt động một chạm: bấm minimize thì còn lại pill nhỏ, bấm `Mở lại/Restore` thì toolbox trở về đúng vị trí top-center, không bị lệch và không mất nút.
- Mic/system audio toggle phản ánh đúng trạng thái. Nếu system audio không capture từ đầu thì icon disabled và có tooltip/lý do.
- Stop quay thì toolbox và surface tự đóng, video vẫn được lưu MP4.
- Sau khi đóng app không còn process/window kẹt.

## IPC chính

- `capture:prepare`: chọn source cho `setDisplayMediaRequestHandler`.
- `region:select`, `region:complete`, `region:cancel`: chọn vùng desktop trước khi quay.
- `recording-overlay:open`, `recording-overlay:update`, `recording-overlay:close`: quản lý toolbox và surface khi quay.
- `recording-overlay:event`: chuyển thao tác toolbox và pointer surface về App.
- `recording:save`: lưu WebM thô, transcode MP4 mặc định và ghi library item.

## Lệnh phát triển

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' run dev
& 'C:\Program Files\nodejs\npm.cmd' run build
& 'C:\Program Files\nodejs\npm.cmd' run pack
```

## Ghi chú kỹ thuật

- `scripts/start-electron-dev.cjs` xóa `ELECTRON_RUN_AS_NODE` trước khi spawn Electron để tránh Electron chạy nhầm như Node.
- Khi chạy bản đóng gói từ PowerShell, cần xóa `ELECTRON_RUN_AS_NODE` nếu biến này đang tồn tại.
- Trên Windows, main process có thể bật software rendering/GPU fallback để tránh lỗi màn hình đen trên driver/môi trường hiển thị không ổn định.
- `vite.config.ts` dùng `base: "./"` để bản đóng gói load JS/CSS bằng đường dẫn tương đối khi chạy qua `file://`.
- `DesktopCaptureRegion` lưu trong `RecordingSettings.captureRegion`; `captureArea` là rect pixel mà compositor dùng để crop video.
- macOS cần quyền Screen Recording, Camera và Microphone trong System Settings.
- System audio trên macOS có thể cần loopback device riêng.
