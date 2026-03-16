#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>

@interface CinemaCameraProcessor : NSObject <RCTBridgeModule>
@end

@implementation CinemaCameraProcessor

RCT_EXPORT_MODULE();

// Resolve actual render size accounting for rotation transform
static CGSize renderSizeForTrack(AVAssetTrack *track) {
  CGSize natural = track.naturalSize;
  CGAffineTransform t = track.preferredTransform;
  // Rotated 90 or 270 degrees → swap width/height
  if (t.a == 0 && t.d == 0) {
    return CGSizeMake(natural.height, natural.width);
  }
  return natural;
}

RCT_EXPORT_METHOD(processVideo:(NSString *)inputUri
                  ratio:(double)ratio
                  fps:(int)fps
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *inputURL;
  if ([inputUri hasPrefix:@"file://"]) {
    inputURL = [NSURL URLWithString:inputUri];
  } else {
    inputURL = [NSURL fileURLWithPath:inputUri];
  }

  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:inputURL options:nil];
  AVAssetTrack *videoTrack = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
  if (!videoTrack) {
    reject(@"NO_VIDEO_TRACK", @"No video track found", nil);
    return;
  }

  CGSize renderSize = renderSizeForTrack(videoTrack);
  CGFloat videoW = renderSize.width;
  CGFloat videoH = renderSize.height;

  // Black bar height (may be 0 if ratio produces no bars)
  CGFloat contentH = videoW / ratio;
  CGFloat barH = MAX(0, floor((videoH - contentH) / 2.0));

  // Composition
  AVMutableComposition *composition = [AVMutableComposition composition];
  CMTimeRange fullRange = CMTimeRangeMake(kCMTimeZero, asset.duration);
  NSError *err;

  AVMutableCompositionTrack *compVideo = [composition addMutableTrackWithMediaType:AVMediaTypeVideo
                                                               preferredTrackID:kCMPersistentTrackID_Invalid];
  [compVideo insertTimeRange:fullRange ofTrack:videoTrack atTime:kCMTimeZero error:&err];
  if (err) { reject(@"ERR_COMPOSE", err.localizedDescription, err); return; }

  AVAssetTrack *audioTrack = [[asset tracksWithMediaType:AVMediaTypeAudio] firstObject];
  if (audioTrack) {
    AVMutableCompositionTrack *compAudio = [composition addMutableTrackWithMediaType:AVMediaTypeAudio
                                                                preferredTrackID:kCMPersistentTrackID_Invalid];
    [compAudio insertTimeRange:fullRange ofTrack:audioTrack atTime:kCMTimeZero error:nil];
  }

  // Layer instruction (apply original transform)
  AVMutableVideoCompositionLayerInstruction *li =
    [AVMutableVideoCompositionLayerInstruction videoCompositionLayerInstructionWithAssetTrack:compVideo];
  [li setTransform:videoTrack.preferredTransform atTime:kCMTimeZero];

  AVMutableVideoCompositionInstruction *vi = [AVMutableVideoCompositionInstruction videoCompositionInstruction];
  vi.timeRange = fullRange;
  vi.layerInstructions = @[li];

  // CALayer setup for black bars
  // AVFoundation CALayer: origin is bottom-left
  CALayer *videoLayer = [CALayer layer];
  videoLayer.frame = CGRectMake(0, 0, videoW, videoH);

  CALayer *parentLayer = [CALayer layer];
  parentLayer.frame = CGRectMake(0, 0, videoW, videoH);
  [parentLayer addSublayer:videoLayer];

  if (barH > 0) {
    CALayer *bottomBar = [CALayer layer];
    bottomBar.frame = CGRectMake(0, 0, videoW, barH);
    bottomBar.backgroundColor = [UIColor blackColor].CGColor;
    [parentLayer addSublayer:bottomBar];

    CALayer *topBar = [CALayer layer];
    topBar.frame = CGRectMake(0, videoH - barH, videoW, barH);
    topBar.backgroundColor = [UIColor blackColor].CGColor;
    [parentLayer addSublayer:topBar];
  }

  AVMutableVideoComposition *videoComposition = [AVMutableVideoComposition videoComposition];
  videoComposition.renderSize = renderSize;
  videoComposition.frameDuration = CMTimeMake(1, fps);
  videoComposition.instructions = @[vi];
  videoComposition.animationTool =
    [AVVideoCompositionCoreAnimationTool
      videoCompositionCoreAnimationToolWithPostProcessingAsVideoLayer:videoLayer
      inLayer:parentLayer];

  // Output path
  NSString *outputPath = [NSTemporaryDirectory()
    stringByAppendingPathComponent:[NSString stringWithFormat:@"cinema_%lld.mp4",
      (long long)([[NSDate date] timeIntervalSince1970] * 1000)]];
  NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
  [[NSFileManager defaultManager] removeItemAtURL:outputURL error:nil];

  AVAssetExportSession *exporter =
    [[AVAssetExportSession alloc] initWithAsset:composition
                                     presetName:AVAssetExportPresetHighestQuality];
  exporter.outputURL = outputURL;
  exporter.outputFileType = AVFileTypeMPEG4;
  exporter.videoComposition = videoComposition;

  [exporter exportAsynchronouslyWithCompletionHandler:^{
    switch (exporter.status) {
      case AVAssetExportSessionStatusCompleted:
        resolve(outputURL.absoluteString);
        break;
      case AVAssetExportSessionStatusFailed:
        reject(@"EXPORT_FAILED", exporter.error.localizedDescription, exporter.error);
        break;
      default:
        reject(@"EXPORT_CANCELLED", @"Export cancelled", nil);
        break;
    }
  }];
}

@end
