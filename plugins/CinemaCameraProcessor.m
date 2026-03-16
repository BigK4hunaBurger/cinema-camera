#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreImage/CoreImage.h>
#import <UIKit/UIKit.h>

@interface CinemaCameraProcessor : NSObject <RCTBridgeModule>
@end

@implementation CinemaCameraProcessor

RCT_EXPORT_MODULE();

// ── Helpers ──────────────────────────────────────────────────────

static CGSize renderSizeForTrack(AVAssetTrack *track) {
  CGSize natural = track.naturalSize;
  CGAffineTransform t = track.preferredTransform;
  if (t.a == 0 && t.d == 0) {
    return CGSizeMake(natural.height, natural.width);
  }
  return natural;
}

// ── Video: black bars + FPS ──────────────────────────────────────

RCT_EXPORT_METHOD(processVideo:(NSString *)inputUri
                  ratio:(double)ratio
                  fps:(int)fps
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *inputURL = [inputUri hasPrefix:@"file://"]
    ? [NSURL URLWithString:inputUri]
    : [NSURL fileURLWithPath:inputUri];

  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:inputURL options:nil];
  AVAssetTrack *videoTrack = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
  if (!videoTrack) { reject(@"NO_VIDEO_TRACK", @"No video track", nil); return; }

  CGSize renderSize = renderSizeForTrack(videoTrack);
  CGFloat videoW = renderSize.width;
  CGFloat videoH = renderSize.height;
  CGFloat contentH = videoW / ratio;
  CGFloat barH = MAX(0, floor((videoH - contentH) / 2.0));

  AVMutableComposition *composition = [AVMutableComposition composition];
  CMTimeRange fullRange = CMTimeRangeMake(kCMTimeZero, asset.duration);
  NSError *err;

  AVMutableCompositionTrack *compVideo =
    [composition addMutableTrackWithMediaType:AVMediaTypeVideo
                           preferredTrackID:kCMPersistentTrackID_Invalid];
  [compVideo insertTimeRange:fullRange ofTrack:videoTrack atTime:kCMTimeZero error:&err];
  if (err) { reject(@"ERR_COMPOSE", err.localizedDescription, err); return; }

  AVAssetTrack *audioTrack = [[asset tracksWithMediaType:AVMediaTypeAudio] firstObject];
  if (audioTrack) {
    AVMutableCompositionTrack *compAudio =
      [composition addMutableTrackWithMediaType:AVMediaTypeAudio
                             preferredTrackID:kCMPersistentTrackID_Invalid];
    [compAudio insertTimeRange:fullRange ofTrack:audioTrack atTime:kCMTimeZero error:nil];
  }

  AVMutableVideoCompositionLayerInstruction *li =
    [AVMutableVideoCompositionLayerInstruction
      videoCompositionLayerInstructionWithAssetTrack:compVideo];
  [li setTransform:videoTrack.preferredTransform atTime:kCMTimeZero];

  AVMutableVideoCompositionInstruction *vi =
    [AVMutableVideoCompositionInstruction videoCompositionInstruction];
  vi.timeRange = fullRange;
  vi.layerInstructions = @[li];

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

  NSString *outputPath = [NSTemporaryDirectory()
    stringByAppendingPathComponent:
      [NSString stringWithFormat:@"cinema_%lld.mp4",
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
        resolve(outputURL.absoluteString); break;
      case AVAssetExportSessionStatusFailed:
        reject(@"EXPORT_FAILED", exporter.error.localizedDescription, exporter.error); break;
      default:
        reject(@"EXPORT_CANCELLED", @"Export cancelled", nil); break;
    }
  }];
}

// ── Photo: retro film processing ─────────────────────────────────

RCT_EXPORT_METHOD(processPhoto:(NSString *)inputUri
                  preset:(NSString *)preset
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *inputURL = [inputUri hasPrefix:@"file://"]
    ? [NSURL URLWithString:inputUri]
    : [NSURL fileURLWithPath:inputUri];

  UIImage *source = [UIImage imageWithContentsOfFile:inputURL.path];
  if (!source) { reject(@"NO_IMAGE", @"Cannot load image", nil); return; }

  // Normalize orientation
  UIGraphicsBeginImageContextWithOptions(source.size, NO, source.scale);
  [source drawInRect:CGRectMake(0, 0, source.size.width, source.size.height)];
  UIImage *oriented = UIGraphicsGetImageFromCurrentImageContext();
  UIGraphicsEndImageContext();

  CIContext *ctx = [CIContext contextWithOptions:nil];
  CIImage *ci = [[CIImage alloc] initWithImage:oriented];

  ci = [self applyPreset:preset toImage:ci];
  ci = [self addGrain:ci];
  ci = [self addVignette:ci];

  NSString *outputPath = [NSTemporaryDirectory()
    stringByAppendingPathComponent:
      [NSString stringWithFormat:@"retro_%lld.jpg",
        (long long)([[NSDate date] timeIntervalSince1970] * 1000)]];
  NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
  [[NSFileManager defaultManager] removeItemAtURL:outputURL error:nil];

  CGImageRef cgImg = [ctx createCGImage:ci fromRect:ci.extent];
  UIImage *result = [UIImage imageWithCGImage:cgImg];
  CGImageRelease(cgImg);

  NSData *jpeg = UIImageJPEGRepresentation(result, 0.80);
  [jpeg writeToURL:outputURL atomically:YES];

  resolve(outputURL.absoluteString);
}

// KODAK 400: warm golden tones
// ILFORD HP5: black & white + contrast
// FUJI 400H: cool cyan-green
// POLAROID: faded, lifted blacks
- (CIImage *)applyPreset:(NSString *)preset toImage:(CIImage *)image {
  if ([preset isEqualToString:@"KODAK"]) {
    CIFilter *f = [CIFilter filterWithName:@"CIColorMatrix"];
    [f setValue:image forKey:kCIInputImageKey];
    [f setValue:[CIVector vectorWithX:1.08 Y:0.0  Z:0.0  W:0.0] forKey:@"inputRVector"];
    [f setValue:[CIVector vectorWithX:0.0  Y:0.96 Z:0.0  W:0.0] forKey:@"inputGVector"];
    [f setValue:[CIVector vectorWithX:0.0  Y:0.0  Z:0.80 W:0.0] forKey:@"inputBVector"];
    [f setValue:[CIVector vectorWithX:0.03 Y:0.01 Z:0.0  W:0.0] forKey:@"inputBiasVector"];
    return f.outputImage;

  } else if ([preset isEqualToString:@"ILFORD"]) {
    CIFilter *bw = [CIFilter filterWithName:@"CIColorControls"];
    [bw setValue:image forKey:kCIInputImageKey];
    [bw setValue:@0.0  forKey:kCIInputSaturationKey];
    [bw setValue:@1.15 forKey:kCIInputContrastKey];
    return bw.outputImage;

  } else if ([preset isEqualToString:@"FUJI"]) {
    CIFilter *f = [CIFilter filterWithName:@"CIColorMatrix"];
    [f setValue:image forKey:kCIInputImageKey];
    [f setValue:[CIVector vectorWithX:0.87 Y:0.0  Z:0.0  W:0.0] forKey:@"inputRVector"];
    [f setValue:[CIVector vectorWithX:0.0  Y:1.02 Z:0.0  W:0.0] forKey:@"inputGVector"];
    [f setValue:[CIVector vectorWithX:0.0  Y:0.0  Z:1.08 W:0.0] forKey:@"inputBVector"];
    [f setValue:[CIVector vectorWithX:0.0  Y:0.02 Z:0.02 W:0.0] forKey:@"inputBiasVector"];
    return f.outputImage;

  } else if ([preset isEqualToString:@"POLAROID"]) {
    CIFilter *fade = [CIFilter filterWithName:@"CIColorControls"];
    [fade setValue:image forKey:kCIInputImageKey];
    [fade setValue:@0.60 forKey:kCIInputSaturationKey];
    [fade setValue:@0.80 forKey:kCIInputContrastKey];
    [fade setValue:@0.07 forKey:kCIInputBrightnessKey];
    return fade.outputImage;
  }
  return image;
}

- (CIImage *)addGrain:(CIImage *)image {
  CIFilter *noise = [CIFilter filterWithName:@"CIRandomGenerator"];
  CIImage *noiseImg = [noise.outputImage imageByCroppingToRect:image.extent];

  CIFilter *desat = [CIFilter filterWithName:@"CIColorControls"];
  [desat setValue:noiseImg forKey:kCIInputImageKey];
  [desat setValue:@0.0    forKey:kCIInputSaturationKey];
  [desat setValue:@0.50   forKey:kCIInputContrastKey];
  [desat setValue:@(-0.1) forKey:kCIInputBrightnessKey];
  noiseImg = desat.outputImage;

  CIFilter *blend = [CIFilter filterWithName:@"CISoftLightBlendMode"];
  [blend setValue:image    forKey:kCIInputBackgroundImageKey];
  [blend setValue:noiseImg forKey:kCIInputImageKey];
  return blend.outputImage;
}

- (CIImage *)addVignette:(CIImage *)image {
  CIFilter *v = [CIFilter filterWithName:@"CIVignette"];
  [v setValue:image forKey:kCIInputImageKey];
  [v setValue:@1.6  forKey:kCIInputRadiusKey];
  [v setValue:@0.55 forKey:kCIInputIntensityKey];
  return v.outputImage;
}

@end
