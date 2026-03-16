import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  Platform,
  Animated,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import { NativeModules } from 'react-native';
const { CinemaCameraProcessor } = NativeModules;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

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

const BLACK = '#000000';
const RED   = '#FF3B30';

const BOOT_LINES = [
  '> CINEMA_CAM  v1.0.0',
  '> BOOTING SYSTEM.................',
  '> SENSOR DRIVER................OK',
  '> LENS CALIBRATION.............OK',
  '> COLOR SCIENCE................OK',
  '> CINEMA MODE ACTIVE.',
];

function formatTimecode(sec, fps) {
  const h  = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m  = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s  = String(sec % 60).padStart(2, '0');
  const ff = String(fps - 1).padStart(2, '0');
  return `${h}:${m}:${s}:${ff}`;
}

// ── Focus Indicator ───────────────────────────────────────────
function FocusBox({ point, color }) {
  const scale   = useRef(new Animated.Value(1.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const SIZE = 56;

  useEffect(() => {
    scale.setValue(1.6);
    opacity.setValue(1);
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, useNativeDriver: true, speed: 20 }),
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]),
    ]).start();
  }, [point]);

  const corner = { width: 10, height: 10, borderColor: color, position: 'absolute' };

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: point.x - SIZE / 2,
        top:  point.y - SIZE / 2,
        width: SIZE, height: SIZE,
        opacity, transform: [{ scale }],
      }}
    >
      {/* Top-left */}
      <View style={[corner, { top: 0, left: 0, borderTopWidth: 1.5, borderLeftWidth: 1.5 }]} />
      {/* Top-right */}
      <View style={[corner, { top: 0, right: 0, borderTopWidth: 1.5, borderRightWidth: 1.5 }]} />
      {/* Bottom-left */}
      <View style={[corner, { bottom: 0, left: 0, borderBottomWidth: 1.5, borderLeftWidth: 1.5 }]} />
      {/* Bottom-right */}
      <View style={[corner, { bottom: 0, right: 0, borderBottomWidth: 1.5, borderRightWidth: 1.5 }]} />
    </Animated.View>
  );
}

// ── Scan lines ────────────────────────────────────────────────
function ScanLines({ height }) {
  const COUNT = 36;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: COUNT }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: i * (height / COUNT),
            left: 0, right: 0,
            height: 1,
            backgroundColor: 'rgba(0,0,0,0.2)',
          }}
        />
      ))}
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function App() {
  const cameraRef = useRef(null);
  const pinchRef  = useRef({ active: false, lastDist: 0 });

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission,    requestMicPermission]    = useMicrophonePermissions();
  const [mediaPermission,  requestMediaPermission]  = MediaLibrary.usePermissions();

  const [ratioIdx,    setRatioIdx]    = useState(0);
  const [fpsIdx,      setFpsIdx]      = useState(0);
  const [themeIdx,    setThemeIdx]    = useState(0);
  const [facing,      setFacing]      = useState('back');
  const [showGrid,    setShowGrid]    = useState(false);
  const [showScan,    setShowScan]    = useState(false);
  const [zoom,        setZoom]        = useState(0);
  const [focusPoint,  setFocusPoint]  = useState(null);
  const [focusKey,    setFocusKey]    = useState(0);
  const [isRecording,   setIsRecording]   = useState(false);
  const [isProcessing,  setIsProcessing]  = useState(false);
  const [elapsed,       setElapsed]       = useState(0);
  const [savedMsg,      setSavedMsg]      = useState('');
  const [blinkOn,       setBlinkOn]       = useState(true);
  const [bootIdx,       setBootIdx]       = useState(-1);

  const theme        = THEMES[themeIdx];
  const currentRatio = RATIOS[ratioIdx];
  const currentFps   = FPS_OPTIONS[fpsIdx];
  const cameraH      = SCREEN_W / currentRatio.value;
  const barH         = Math.max(40, (SCREEN_H - cameraH) / 2);
  const booting      = bootIdx < BOOT_LINES.length - 1;

  // Boot
  useEffect(() => {
    const id = setInterval(() => {
      setBootIdx(i => i + 1);
    }, 260);
    return () => clearInterval(id);
  }, []);

  // Blink
  useEffect(() => {
    const id = setInterval(() => setBlinkOn(v => !v), 500);
    return () => clearInterval(id);
  }, []);

  // Timer
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

  // Touch handlers on camera view
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
      const dx   = touches[0].pageX - touches[1].pageX;
      const dy   = touches[0].pageY - touches[1].pageY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (pinchRef.current.active) {
        const delta = (dist - pinchRef.current.lastDist) / 500;
        setZoom(z => Math.min(1, Math.max(0, z + delta)));
      }
      pinchRef.current = { active: true, lastDist: dist };
    },
    onResponderRelease: () => {
      pinchRef.current = { active: false, lastDist: 0 };
    },
  };

  const processVideo = useCallback(async (inputUri, ratio, fps) => {
    const outputUri = await CinemaCameraProcessor.processVideo(inputUri, ratio, fps);
    return outputUri;
  }, []);

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || isRecording) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsRecording(true);
    try {
      const video = await cameraRef.current.recordAsync();
      if (video?.uri) {
        setIsProcessing(true);
        try {
          const processedUri = await processVideo(video.uri, currentRatio.value, currentFps);
          const asset = await MediaLibrary.createAssetAsync(processedUri);
          await MediaLibrary.createAlbumAsync('CinemaCamera', asset, false);
          await FileSystem.deleteAsync(video.uri, { idempotent: true });
          await FileSystem.deleteAsync(processedUri, { idempotent: true });
          setSavedMsg('> CLIP SAVED TO ROLL');
          setTimeout(() => setSavedMsg(''), 3000);
        } finally {
          setIsProcessing(false);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRecording(false);
    }
  }, [isRecording, currentRatio, currentFps, processVideo]);

  const stopRecording = useCallback(async () => {
    if (!cameraRef.current || !isRecording) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await cameraRef.current.stopRecording();
  }, [isRecording]);

  // ── Boot screen ───────────────────────────────────────────────
  if (booting) {
    return (
      <View style={styles.fullScreen}>
        <StatusBar hidden />
        {BOOT_LINES.slice(0, bootIdx + 1).map((line, i) => (
          <Text
            key={i}
            style={[
              styles.bootText,
              { color: i === bootIdx ? THEMES[0].fg : THEMES[0].dim },
            ]}
          >
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
          {'> CINEMA_CAM  v1.0.0'}
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
        <TouchableOpacity
          style={[styles.permBtn, { borderColor: theme.fg, marginTop: 36 }]}
          onPress={requestAll}
        >
          <Text style={[styles.bootText, { color: theme.fg, fontWeight: 'bold', letterSpacing: 2 }]}>
            {'[ GRANT ACCESS ]'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main ──────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* ── TOP BAR ── */}
      <View style={[styles.bar, { height: barH }]}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: theme.fg }]}>CINEMA_CAM</Text>
          <Text style={[styles.label, { color: isRecording ? RED : theme.dim }]}>
            {isRecording && blinkOn ? '● REC' : isRecording ? '  REC' : '○ STBY'}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={[styles.small, { color: theme.dim }]}>
            {`${currentFps}FPS  ${currentRatio.label}  ${zoom > 0.01 ? `${(1 + zoom * 9).toFixed(1)}x` : '1.0x'}`}
          </Text>
          <Text style={[styles.small, { color: isRecording ? RED : theme.dim }]}>
            {isRecording ? formatTimecode(elapsed, currentFps) : '--:--:--:--'}
          </Text>
        </View>

        {savedMsg !== '' && (
          <Text style={[styles.small, { color: theme.fg }]}>{savedMsg}</Text>
        )}
        {isProcessing && (
          <Text style={[styles.small, { color: theme.dim }]}>{'> PROCESSING...'}</Text>
        )}
      </View>

      {/* ── CAMERA ── */}
      <View style={{ width: SCREEN_W, height: cameraH, overflow: 'hidden' }}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="video"
          zoom={zoom}
        />

        {showScan && <ScanLines height={cameraH} />}

        {showGrid && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={[styles.gridV, { left: SCREEN_W / 3,       borderColor: theme.dim + '60' }]} />
            <View style={[styles.gridV, { left: (SCREEN_W * 2) / 3, borderColor: theme.dim + '60' }]} />
            <View style={[styles.gridH, { top: cameraH / 3,         borderColor: theme.dim + '60' }]} />
            <View style={[styles.gridH, { top: (cameraH * 2) / 3,   borderColor: theme.dim + '60' }]} />
            {/* Center cross */}
            <View style={[styles.gridH, { top: cameraH / 2 - 0.5, width: 20, alignSelf: 'center', borderColor: theme.fg + '80' }]} />
            <View style={[styles.gridV, { left: SCREEN_W / 2 - 0.5, height: 20, top: cameraH / 2 - 10, borderColor: theme.fg + '80' }]} />
          </View>
        )}

        {/* Gesture overlay */}
        <View style={StyleSheet.absoluteFill} {...cameraHandlers} />

        {/* Focus indicator */}
        {focusPoint && (
          <FocusBox key={focusKey} point={focusPoint} color={theme.fg} />
        )}

        {/* Vignette */}
        <View pointerEvents="none" style={styles.vignette} />

        {/* REC corner flash */}
        {isRecording && blinkOn && (
          <View pointerEvents="none" style={[styles.recDot, { backgroundColor: RED }]} />
        )}
      </View>

      {/* ── BOTTOM BAR ── */}
      <View style={[styles.bar, { height: barH }]}>
        {/* Chips */}
        <View style={styles.chips}>
          <Chip label={`${currentFps}FPS`} theme={theme} disabled={isRecording}
            onPress={() => setFpsIdx(i => (i + 1) % FPS_OPTIONS.length)} />
          <Chip label={currentRatio.label} theme={theme} disabled={isRecording}
            onPress={() => setRatioIdx(i => (i + 1) % RATIOS.length)} />
          <Chip label={facing === 'back' ? 'REAR' : 'FRNT'} theme={theme} disabled={isRecording}
            onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} />
          <Chip label="GRID" theme={theme} active={showGrid}
            onPress={() => setShowGrid(v => !v)} />
          <Chip label="SCAN" theme={theme} active={showScan}
            onPress={() => setShowScan(v => !v)} />
          <Chip label={theme.name} theme={theme} disabled={isRecording}
            onPress={() => setThemeIdx(i => (i + 1) % THEMES.length)} />
        </View>

        {/* Record button */}
        <View style={styles.recRow}>
          <TouchableOpacity
            style={[styles.recBtn, { borderColor: isRecording ? RED : theme.fg }, isProcessing && { opacity: 0.3 }]}
            onPress={isRecording ? stopRecording : startRecording}
            activeOpacity={0.6}
            disabled={isProcessing}
          >
            <Text style={[styles.recText, { color: isRecording ? RED : theme.fg }]}>
              {isProcessing ? '[ ⏳ WAIT  ]' : isRecording ? '[ ■  STOP ]' : '[ ●  REC  ]'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.small, { color: theme.dim, textAlign: 'center' }]}>
          {'PINCH:ZOOM  TAP:FOCUS  SWIPE:SETTINGS'}
        </Text>
      </View>
    </View>
  );
}

// ── Chip component ────────────────────────────────────────────
function Chip({ label, theme, onPress, disabled = false, active = false }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}>
      <Text
        style={[
          styles.chip,
          {
            color:       active ? theme.fg  : theme.dim,
            borderColor: active ? theme.fg  : theme.dim + '70',
          },
          disabled && { opacity: 0.2 },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BLACK,
  },
  fullScreen: {
    flex: 1,
    backgroundColor: BLACK,
    padding: 32,
    justifyContent: 'center',
    gap: 10,
  },
  bootText: {
    fontFamily: FONT,
    fontSize: 13,
    letterSpacing: 1,
  },
  permBtn: {
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
  },
  bar: {
    backgroundColor: BLACK,
    paddingHorizontal: 14,
    justifyContent: 'center',
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  small: {
    fontFamily: FONT,
    fontSize: 10,
    letterSpacing: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  chip: {
    fontFamily: FONT,
    fontSize: 11,
    letterSpacing: 1,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  recRow: {
    alignItems: 'center',
    marginVertical: 6,
  },
  recBtn: {
    borderWidth: 1,
    paddingHorizontal: 32,
    paddingVertical: 11,
  },
  recText: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 3,
  },
  // Camera overlays
  vignette: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 36,
    borderColor: 'rgba(0,0,0,0.50)',
  },
  recDot: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
