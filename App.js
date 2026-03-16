import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Platform,
  Animated,
  NativeModules,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

const { CinemaCameraProcessor } = NativeModules;
const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';
const BLACK = '#000000';
const RED   = '#FF3B30';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const RATIOS = [
  { label: '2.39:1', value: 2.39 },
  { label: '2.35:1', value: 2.35 },
  { label: '1.85:1', value: 1.85 },
  { label: '16:9',   value: 16 / 9 },
];
const FPS_OPTIONS = [24, 25, 30];
const THEMES = [
  { name: 'GREEN', fg: '#00FF41', dim: '#007A1F' },
  { name: 'AMBER', fg: '#FFB000', dim: '#996800' },
  { name: 'WHITE', fg: '#DEDEDE', dim: '#777777' },
];
const FILM_PRESETS = [
  { name: 'KODAK',    tag: 'KODAK 400',  fg: '#FFB84D', dim: '#7A5200' },
  { name: 'ILFORD',   tag: 'ILFORD HP5', fg: '#DEDEDE', dim: '#777777' },
  { name: 'FUJI',     tag: 'FUJI 400H',  fg: '#7FD9A4', dim: '#2E7A50' },
  { name: 'POLAROID', tag: 'POLAROID',   fg: '#A8CFFF', dim: '#3A6FAA' },
];
const BOOT_LINES = [
  '> CINEMA_CAM  v1.1.0',
  '> BOOTING SYSTEM.................',
  '> SENSOR DRIVER................OK',
  '> LENS CALIBRATION.............OK',
  '> COLOR SCIENCE................OK',
  '> FILM ENGINE..................OK',
  '> CINEMA MODE ACTIVE.',
];

function formatTimecode(sec, fps) {
  const h  = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m  = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s  = String(sec % 60).padStart(2, '0');
  const ff = String(fps - 1).padStart(2, '0');
  return `${h}:${m}:${s}:${ff}`;
}

function FocusBox({ point, color }) {
  const scale   = useRef(new Animated.Value(1.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const SIZE = 56;
  useEffect(() => {
    scale.setValue(1.6); opacity.setValue(1);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }),
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]),
    ]).start();
  }, [point]);
  const corner = { width: 10, height: 10, borderColor: color, position: 'absolute' };
  return (
    <Animated.View pointerEvents="none"
      style={{ position: 'absolute', left: point.x - SIZE / 2, top: point.y - SIZE / 2,
               width: SIZE, height: SIZE, opacity, transform: [{ scale }] }}>
      <View style={[corner, { top: 0, left: 0, borderTopWidth: 1.5, borderLeftWidth: 1.5 }]} />
      <View style={[corner, { top: 0, right: 0, borderTopWidth: 1.5, borderRightWidth: 1.5 }]} />
      <View style={[corner, { bottom: 0, left: 0, borderBottomWidth: 1.5, borderLeftWidth: 1.5 }]} />
      <View style={[corner, { bottom: 0, right: 0, borderBottomWidth: 1.5, borderRightWidth: 1.5 }]} />
    </Animated.View>
  );
}

function ScanLines({ height }) {
  const COUNT = 36;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: COUNT }).map((_, i) => (
        <View key={i} style={{ position: 'absolute', top: i * (height / COUNT),
                               left: 0, right: 0, height: 1, backgroundColor: 'rgba(0,0,0,0.2)' }} />
      ))}
    </View>
  );
}

function Chip({ label, theme, onPress, disabled = false, active = false }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}>
      <Text style={[styles.chip,
        { color: active ? theme.fg : theme.dim, borderColor: active ? theme.fg : theme.dim + '70' },
        disabled && { opacity: 0.2 }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function App() {
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const cameraRef  = useRef(null);
  const pinchRef   = useRef({ active: false, lastDist: 0 });
  const shutterAnim = useRef(new Animated.Value(0)).current;

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission,    requestMicPermission]    = useMicrophonePermissions();
  const [mediaPermission,  requestMediaPermission]  = MediaLibrary.usePermissions();

  const [mode,          setMode]          = useState('video');
  const [ratioIdx,      setRatioIdx]      = useState(0);
  const [fpsIdx,        setFpsIdx]        = useState(0);
  const [themeIdx,      setThemeIdx]      = useState(0);
  const [filmPresetIdx, setFilmPresetIdx] = useState(0);
  const [facing,        setFacing]        = useState('back');
  const [showGrid,      setShowGrid]      = useState(false);
  const [showScan,      setShowScan]      = useState(false);
  const [zoom,          setZoom]          = useState(0);
  const [focusPoint,    setFocusPoint]    = useState(null);
  const [focusKey,      setFocusKey]      = useState(0);
  const [isRecording,   setIsRecording]   = useState(false);
  const [isProcessing,  setIsProcessing]  = useState(false);
  const [isCapturing,   setIsCapturing]   = useState(false);
  const [elapsed,       setElapsed]       = useState(0);
  const [savedMsg,      setSavedMsg]      = useState('');
  const [blinkOn,       setBlinkOn]       = useState(true);
  const [bootIdx,       setBootIdx]       = useState(-1);

  const theme        = THEMES[themeIdx];
  const film         = FILM_PRESETS[filmPresetIdx];
  const currentRatio = RATIOS[ratioIdx];
  const currentFps   = FPS_OPTIONS[fpsIdx];
  const isPhoto      = mode === 'photo';
  const activeColor  = isPhoto ? film : theme;

  // Camera viewport: fill width, clamp height so bars stay visible
  const cameraH = Math.min(SCREEN_W / currentRatio.value, SCREEN_H - 80);
  const barH    = Math.max(40, (SCREEN_H - cameraH) / 2);
  const booting = bootIdx < BOOT_LINES.length - 1;

  useEffect(() => { Notifications.requestPermissionsAsync(); }, []);
  useEffect(() => {
    const id = setInterval(() => setBootIdx(i => i + 1), 260);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setBlinkOn(v => !v), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!isRecording) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(v => v + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const allGranted = cameraPermission?.granted && micPermission?.granted && mediaPermission?.granted;
  const requestAll = async () => {
    if (!cameraPermission?.granted) await requestCameraPermission();
    if (!micPermission?.granted)    await requestMicPermission();
    if (!mediaPermission?.granted)  await requestMediaPermission();
  };

  const notify = useCallback(async (body) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'CinemaCamera', body },
        trigger: null,
      });
    } catch (_) {}
  }, []);

  const showMsg = useCallback((msg) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(''), 3000);
  }, []);

  const cameraHandlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder:  () => true,
    onResponderGrant: (e) => {
      const touches = e.nativeEvent.touches;
      if (touches.length === 1) {
        setFocusPoint({ x: touches[0].pageX, y: touches[0].pageY - barH });
        setFocusKey(k => k + 1);
      }
    },
    onResponderMove: (e) => {
      const touches = e.nativeEvent.touches;
      if (touches.length !== 2) return;
      const dx = touches[0].pageX - touches[1].pageX;
      const dy = touches[0].pageY - touches[1].pageY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (pinchRef.current.active) {
        const delta = (dist - pinchRef.current.lastDist) / 500;
        setZoom(z => Math.min(1, Math.max(0, z + delta)));
      }
      pinchRef.current = { active: true, lastDist: dist };
    },
    onResponderRelease: () => { pinchRef.current = { active: false, lastDist: 0 }; },
  };

  // ── Video recording ───────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!cameraRef.current || isRecording) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsRecording(true);
    try {
      const video = await cameraRef.current.recordAsync();
      if (video?.uri) {
        setIsProcessing(true);
        setSavedMsg('> PROCESSING...');
        try {
          const processed = await CinemaCameraProcessor.processVideo(
            video.uri, currentRatio.value, currentFps
          );
          const asset = await MediaLibrary.createAssetAsync(processed);
          await MediaLibrary.createAlbumAsync('CinemaCamera', asset, false);
          showMsg('> CLIP SAVED TO ROLL');
          notify('Clip saved to roll');
        } finally {
          setIsProcessing(false);
        }
      }
    } catch (e) {
      console.error(e);
      setSavedMsg('');
    } finally {
      setIsRecording(false);
    }
  }, [isRecording, currentRatio, currentFps, notify, showMsg]);

  const stopRecording = useCallback(async () => {
    if (!cameraRef.current || !isRecording) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await cameraRef.current.stopRecording();
  }, [isRecording]);

  // ── Photo capture ─────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsCapturing(true);

    // Shutter flash
    Animated.sequence([
      Animated.timing(shutterAnim, { toValue: 1, duration: 50,  useNativeDriver: true }),
      Animated.timing(shutterAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: false });
      setSavedMsg('> DEVELOPING...');
      const processed = await CinemaCameraProcessor.processPhoto(photo.uri, film.name);
      const asset = await MediaLibrary.createAssetAsync(processed);
      await MediaLibrary.createAlbumAsync('CinemaCamera', asset, false);
      showMsg('> FRAME SAVED');
      notify('Frame saved to roll');
    } catch (e) {
      console.error(e);
      setSavedMsg('');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, film, notify, showMsg]);

  // ── Boot screen ───────────────────────────────────────────────
  if (booting) {
    return (
      <View style={styles.fullScreen}>
        <StatusBar hidden />
        {BOOT_LINES.slice(0, bootIdx + 1).map((line, i) => (
          <Text key={i} style={[styles.bootText,
            { color: i === bootIdx ? THEMES[0].fg : THEMES[0].dim }]}>
            {line}
          </Text>
        ))}
        {blinkOn && bootIdx >= 0 && (
          <Text style={[styles.bootText, { color: THEMES[0].dim }]}>█</Text>
        )}
      </View>
    );
  }

  // ── Permission screen ─────────────────────────────────────────
  if (!allGranted) {
    return (
      <View style={styles.fullScreen}>
        <StatusBar hidden />
        <Text style={[styles.bootText, { color: theme.fg, fontSize: 15, fontWeight: 'bold', letterSpacing: 2, marginBottom: 20 }]}>
          {'> CINEMA_CAM  v1.1.0'}
        </Text>
        <Text style={[styles.bootText, { color: theme.dim }]}>
          {'> CAMERA : ' + (cameraPermission?.granted ? '[  OK  ]' : '[NEEDED]')}
        </Text>
        <Text style={[styles.bootText, { color: theme.dim }]}>
          {'> MIC    : ' + (micPermission?.granted    ? '[  OK  ]' : '[NEEDED]')}
        </Text>
        <Text style={[styles.bootText, { color: theme.dim }]}>
          {'> MEDIA  : ' + (mediaPermission?.granted  ? '[  OK  ]' : '[NEEDED]')}
        </Text>
        <TouchableOpacity style={[styles.permBtn, { borderColor: theme.fg, marginTop: 36 }]} onPress={requestAll}>
          <Text style={[styles.bootText, { color: theme.fg, fontWeight: 'bold', letterSpacing: 2 }]}>
            {'[ GRANT ACCESS ]'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* TOP BAR */}
      <View style={[styles.bar, { height: barH }]}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: activeColor.fg }]}>
            {isPhoto ? `CINEMA_CAM : ${film.tag}` : 'CINEMA_CAM'}
          </Text>
          <Text style={[styles.label, { color: isRecording ? RED : activeColor.dim }]}>
            {isRecording && blinkOn ? '● REC' : isRecording ? '  REC' : isPhoto ? '▣ FILM' : '○ STBY'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.small, { color: activeColor.dim }]}>
            {isPhoto
              ? `${film.name}  ISO 400  35mm`
              : `${currentFps}FPS  ${currentRatio.label}  ${zoom > 0.01 ? `${(1 + zoom * 9).toFixed(1)}x` : '1.0x'}`
            }
          </Text>
          <Text style={[styles.small, { color: isRecording ? RED : activeColor.dim }]}>
            {isRecording ? formatTimecode(elapsed, currentFps) : '--:--:--:--'}
          </Text>
        </View>
        {savedMsg !== '' && (
          <Text style={[styles.small, {
            color: savedMsg.includes('DEVELOPING') ? activeColor.dim : activeColor.fg
          }]}>
            {savedMsg}
          </Text>
        )}
      </View>

      {/* CAMERA VIEWPORT */}
      <View style={{ width: SCREEN_W, height: cameraH, overflow: 'hidden' }}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode={isPhoto ? 'picture' : 'video'}
          zoom={zoom}
        />

        {showScan && <ScanLines height={cameraH} />}

        {showGrid && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={[styles.gridV, { left: SCREEN_W / 3,       borderColor: activeColor.dim + '60' }]} />
            <View style={[styles.gridV, { left: (SCREEN_W * 2) / 3, borderColor: activeColor.dim + '60' }]} />
            <View style={[styles.gridH, { top: cameraH / 3,         borderColor: activeColor.dim + '60' }]} />
            <View style={[styles.gridH, { top: (cameraH * 2) / 3,   borderColor: activeColor.dim + '60' }]} />
            <View style={[styles.gridH, { top: cameraH / 2 - 0.5, width: 20, alignSelf: 'center', borderColor: activeColor.fg + '80' }]} />
            <View style={[styles.gridV, { left: SCREEN_W / 2 - 0.5, height: 20, top: cameraH / 2 - 10, borderColor: activeColor.fg + '80' }]} />
          </View>
        )}

        <View style={StyleSheet.absoluteFill} {...cameraHandlers} />

        {focusPoint && (
          <FocusBox key={focusKey} point={focusPoint} color={activeColor.fg} />
        )}

        <View pointerEvents="none" style={styles.vignette} />

        {isRecording && blinkOn && (
          <View pointerEvents="none" style={[styles.recDot, { backgroundColor: RED }]} />
        )}

        {/* Shutter flash */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: 'white', opacity: shutterAnim }]}
        />
      </View>

      {/* BOTTOM BAR */}
      <View style={[styles.bar, { height: barH }]}>

        {/* Mode tabs */}
        <View style={[styles.row, { justifyContent: 'center', gap: 8 }]}>
          {['video', 'photo'].map((m) => {
            const isActive = mode === m;
            const color = m === 'photo' && isActive ? film.fg : isActive ? theme.fg : theme.dim;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => setMode(m)}
                disabled={isRecording || isProcessing}
                style={[styles.modeTab, { borderColor: color }]}
              >
                <Text style={[styles.small, { color, letterSpacing: 2 }]}>
                  {m.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Chips row */}
        <View style={styles.chips}>
          {isPhoto ? (
            FILM_PRESETS.map((p, idx) => (
              <TouchableOpacity key={p.name} onPress={() => setFilmPresetIdx(idx)}>
                <Text style={[styles.chip, {
                  color: filmPresetIdx === idx ? p.fg : theme.dim,
                  borderColor: filmPresetIdx === idx ? p.fg : theme.dim + '70',
                }]}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))
          ) : (
            <>
              <Chip label={`${currentFps}FPS`}              theme={theme} disabled={isRecording} onPress={() => setFpsIdx(i => (i + 1) % FPS_OPTIONS.length)} />
              <Chip label={currentRatio.label}               theme={theme} disabled={isRecording} onPress={() => setRatioIdx(i => (i + 1) % RATIOS.length)} />
              <Chip label={facing === 'back' ? 'REAR' : 'FRNT'} theme={theme} disabled={isRecording} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} />
              <Chip label="GRID" theme={theme} active={showGrid} onPress={() => setShowGrid(v => !v)} />
              <Chip label="SCAN" theme={theme} active={showScan} onPress={() => setShowScan(v => !v)} />
              <Chip label={theme.name} theme={theme} disabled={isRecording} onPress={() => setThemeIdx(i => (i + 1) % THEMES.length)} />
            </>
          )}
        </View>

        {/* Action button */}
        <View style={styles.recRow}>
          {isPhoto ? (
            <TouchableOpacity
              style={[styles.recBtn, { borderColor: film.fg }, isCapturing && { opacity: 0.4 }]}
              onPress={capturePhoto}
              disabled={isCapturing}
              activeOpacity={0.6}
            >
              <Text style={[styles.recText, { color: film.fg }]}>
                {isCapturing ? '[ ◎ SHOOT ]' : '[ ◉ SHOOT ]'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.recBtn, { borderColor: isRecording ? RED : theme.fg }, isProcessing && { opacity: 0.3 }]}
              onPress={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
              activeOpacity={0.6}
            >
              <Text style={[styles.recText, { color: isRecording ? RED : theme.fg }]}>
                {isProcessing ? '[ ⏳ WAIT  ]' : isRecording ? '[ ■  STOP ]' : '[ ●  REC  ]'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={[styles.small, { color: activeColor.dim, textAlign: 'center' }]}>
          {isPhoto
            ? 'PINCH:ZOOM  TAP:FOCUS  TAP:PRESET'
            : 'PINCH:ZOOM  TAP:FOCUS  TAP:SETTINGS'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BLACK },
  fullScreen: { flex: 1, backgroundColor: BLACK, padding: 32, justifyContent: 'center', gap: 10 },
  bootText:   { fontFamily: FONT, fontSize: 13, letterSpacing: 1 },
  permBtn:    { borderWidth: 1, padding: 14, alignItems: 'center' },
  bar:        { backgroundColor: BLACK, paddingHorizontal: 14, justifyContent: 'center', gap: 5 },
  row:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:      { fontFamily: FONT, fontSize: 12, fontWeight: 'bold', letterSpacing: 2 },
  small:      { fontFamily: FONT, fontSize: 10, letterSpacing: 1 },
  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip:       { fontFamily: FONT, fontSize: 11, letterSpacing: 1, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  modeTab:    { borderWidth: 1, paddingHorizontal: 18, paddingVertical: 4 },
  recRow:     { alignItems: 'center', marginVertical: 2 },
  recBtn:     { borderWidth: 1, paddingHorizontal: 32, paddingVertical: 11 },
  recText:    { fontFamily: FONT, fontSize: 15, fontWeight: 'bold', letterSpacing: 3 },
  vignette:   { ...StyleSheet.absoluteFillObject, borderWidth: 36, borderColor: 'rgba(0,0,0,0.50)' },
  recDot:     { position: 'absolute', top: 10, right: 12, width: 8, height: 8, borderRadius: 4 },
  gridV:      { position: 'absolute', top: 0, bottom: 0, width: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  gridH:      { position: 'absolute', left: 0, right: 0, height: 0, borderTopWidth: StyleSheet.hairlineWidth },
});
