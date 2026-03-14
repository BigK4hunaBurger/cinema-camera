import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Cinema aspect ratios
const RATIOS = [
  { label: '2.39:1', value: 2.39 },
  { label: '2.35:1', value: 2.35 },
  { label: '1.85:1', value: 1.85 },
  { label: '16:9',   value: 16 / 9 },
];

const FPS_OPTIONS = [24, 25, 30];

const GREEN = '#00FF41';
const DIM_GREEN = '#00AA2A';
const BLACK = '#000000';
const RED = '#FF3B30';

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function App() {
  const cameraRef = useRef(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ratioIdx, setRatioIdx] = useState(0);
  const [fpsIdx, setFpsIdx] = useState(0);
  const [facing, setFacing] = useState('back');
  const [savedMsg, setSavedMsg] = useState('');
  const [blinkOn, setBlinkOn] = useState(true);

  const currentRatio = RATIOS[ratioIdx];
  const currentFps = FPS_OPTIONS[fpsIdx];

  // Camera preview height based on selected ratio
  const cameraH = SCREEN_W / currentRatio.value;
  const barH = Math.max(0, (SCREEN_H - cameraH) / 2);

  // Blink effect for REC indicator
  useEffect(() => {
    const id = setInterval(() => setBlinkOn(v => !v), 500);
    return () => clearInterval(id);
  }, []);

  // Elapsed timer while recording
  useEffect(() => {
    if (!isRecording) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(v => v + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const allGranted =
    cameraPermission?.granted && micPermission?.granted && mediaPermission?.granted;

  const requestAll = async () => {
    if (!cameraPermission?.granted) await requestCameraPermission();
    if (!micPermission?.granted) await requestMicPermission();
    if (!mediaPermission?.granted) await requestMediaPermission();
  };

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || isRecording) return;
    setIsRecording(true);
    try {
      const video = await cameraRef.current.recordAsync({ fps: currentFps });
      if (video?.uri) {
        const asset = await MediaLibrary.createAssetAsync(video.uri);
        await MediaLibrary.createAlbumAsync('CinemaCamera', asset, false);
        setSavedMsg('> SAVED TO CAMERA ROLL');
        setTimeout(() => setSavedMsg(''), 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRecording(false);
    }
  }, [isRecording, currentFps]);

  const stopRecording = useCallback(() => {
    if (!cameraRef.current || !isRecording) return;
    cameraRef.current.stopRecording();
  }, [isRecording]);

  const toggleRecording = () => {
    isRecording ? stopRecording() : startRecording();
  };

  const cycleRatio = () => {
    if (isRecording) return;
    setRatioIdx(i => (i + 1) % RATIOS.length);
  };

  const cycleFps = () => {
    if (isRecording) return;
    setFpsIdx(i => (i + 1) % FPS_OPTIONS.length);
  };

  const toggleFacing = () => {
    if (isRecording) return;
    setFacing(f => (f === 'back' ? 'front' : 'back'));
  };

  // ── Permission screen ──────────────────────────────────────────
  if (!allGranted) {
    return (
      <View style={styles.permScreen}>
        <StatusBar barStyle="light-content" backgroundColor={BLACK} />
        <Text style={styles.permTitle}>{'> CINEMA_CAM v1.0'}</Text>
        <Text style={styles.permLine}>{'> INITIALIZING...'}</Text>
        <Text style={styles.permLine}>{'> CAMERA: ' + (cameraPermission?.granted ? 'OK' : 'REQUIRED')}</Text>
        <Text style={styles.permLine}>{'> MIC:    ' + (micPermission?.granted ? 'OK' : 'REQUIRED')}</Text>
        <Text style={styles.permLine}>{'> MEDIA:  ' + (mediaPermission?.granted ? 'OK' : 'REQUIRED')}</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestAll}>
          <Text style={styles.permBtnText}>{'[ GRANT ACCESS ]'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* TOP BAR */}
      <View style={[styles.bar, { height: barH }]}>
        <View style={styles.topRow}>
          <Text style={styles.label}>{'> CINEMA_CAM'}</Text>
          <Text style={[styles.label, isRecording && { color: RED }]}>
            {isRecording && blinkOn ? '● REC' : isRecording ? '  REC' : '○ STBY'}
          </Text>
        </View>
        <View style={styles.topRow}>
          <Text style={styles.dimLabel}>{'> MODE: CINEMA'}</Text>
          <Text style={[styles.label, isRecording && { color: RED }]}>
            {isRecording ? formatTime(elapsed) : '--:--'}
          </Text>
        </View>
        {savedMsg ? <Text style={[styles.dimLabel, { color: GREEN }]}>{savedMsg}</Text> : null}
      </View>

      {/* CAMERA */}
      <View style={{ width: SCREEN_W, height: cameraH }}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="video"
        />
        {/* Subtle vignette */}
        <View pointerEvents="none" style={styles.vignette} />
      </View>

      {/* BOTTOM BAR */}
      <View style={[styles.bar, { height: barH }]}>
        {/* Settings */}
        <View style={styles.settingsRow}>
          <TouchableOpacity onPress={cycleFps} disabled={isRecording}>
            <Text style={[styles.settingBtn, isRecording && styles.disabled]}>
              {`[FPS:${currentFps}]`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={cycleRatio} disabled={isRecording}>
            <Text style={[styles.settingBtn, isRecording && styles.disabled]}>
              {`[${currentRatio.label}]`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={toggleFacing} disabled={isRecording}>
            <Text style={[styles.settingBtn, isRecording && styles.disabled]}>
              {`[${facing === 'back' ? 'REAR' : 'FRNT'}]`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Record button */}
        <View style={styles.recRow}>
          <TouchableOpacity
            style={[styles.recBtn, isRecording && styles.recBtnActive]}
            onPress={toggleRecording}
            activeOpacity={0.7}
          >
            <Text style={[styles.recBtnText, isRecording && { color: RED }]}>
              {isRecording ? '[ ■ STOP ]' : '[ ● REC ]'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.dimLabel}>
          {`> ${currentFps}FPS · ${currentRatio.label} · CINEMATIC`}
        </Text>
      </View>
    </View>
  );
}

const FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BLACK,
  },
  bar: {
    backgroundColor: BLACK,
    paddingHorizontal: 16,
    justifyContent: 'center',
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: GREEN,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  dimLabel: {
    color: DIM_GREEN,
    fontFamily: FONT,
    fontSize: 11,
    letterSpacing: 1,
  },
  settingsRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 4,
  },
  settingBtn: {
    color: GREEN,
    fontFamily: FONT,
    fontSize: 13,
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: DIM_GREEN,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  disabled: {
    color: '#004010',
    borderColor: '#002008',
  },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
  },
  recBtn: {
    borderWidth: 1,
    borderColor: GREEN,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  recBtnActive: {
    borderColor: RED,
  },
  recBtnText: {
    color: GREEN,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 32,
    borderColor: 'rgba(0,0,0,0.4)',
  },
  permScreen: {
    flex: 1,
    backgroundColor: BLACK,
    padding: 32,
    justifyContent: 'center',
    gap: 12,
  },
  permTitle: {
    color: GREEN,
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 16,
  },
  permLine: {
    color: DIM_GREEN,
    fontFamily: FONT,
    fontSize: 14,
    letterSpacing: 1,
  },
  permBtn: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: GREEN,
    padding: 16,
    alignItems: 'center',
  },
  permBtnText: {
    color: GREEN,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
});
