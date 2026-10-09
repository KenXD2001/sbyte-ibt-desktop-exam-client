import {
  FaceDetector,
  FaceLandmarker,
  FilesetResolver,
  ObjectDetector,
} from "@mediapipe/tasks-vision";
import * as faceapi from "@vladmandic/face-api";

// Official MediaPipe Tasks Vision setup — see
// https://developers.google.com/edge/mediapipe/solutions/setup_web and the
// per-task web_js guides (face_detector / face_landmarker / object_detector).
// Identity uses face-api 128-d descriptors (see below). All inference runs
// on-device; no frame leaves the browser except the flag snapshots POSTed
// to exam-server.
const TASKS_VISION_VERSION = "1.0.1";
export const AI_PROCTOR_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;

export const AI_PROCTOR_MODELS = {
  faceDetector:
    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
  faceLandmarker:
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  objectDetector:
    "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite",
} as const;

/**
 * Face-recognition models (@vladmandic/face-api, maintained face-api.js fork).
 * Tiny detector + tiny landmarks keep per-tick cost low; the 128-d
 * FaceRecognitionNet descriptor is the actual identity signal — unlike the
 * generic MobileNet embedding tried before, it ignores background/lighting.
 */
const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";
/** Standard face-api verification cutoff: distance above this = different person. */
export const FACE_DISTANCE_THRESHOLD = 0.6;

export interface AiProctorModels {
  faceDetector: FaceDetector;
  faceLandmarker: FaceLandmarker;
  objectDetector: ObjectDetector;
  close: () => void;
}

let cachedVision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;

async function getVision() {
  if (!cachedVision) {
    cachedVision = await FilesetResolver.forVisionTasks(AI_PROCTOR_WASM_URL);
  }
  return cachedVision;
}

export async function loadAiProctorModels(): Promise<AiProctorModels> {
  const vision = await getVision();
  const [faceDetector, faceLandmarker, objectDetector] = await Promise.all([
    FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: AI_PROCTOR_MODELS.faceDetector, delegate: "CPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    }),
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: AI_PROCTOR_MODELS.faceLandmarker, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 2,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    }),
    ObjectDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: AI_PROCTOR_MODELS.objectDetector, delegate: "CPU" },
      runningMode: "VIDEO",
      maxResults: 5,
      scoreThreshold: PHONE_SCORE_THRESHOLD,
      // COCO label for phones is "cell phone" — allowlist keeps only it so
      // books/bottles/laptops on the desk don't raise false flags.
      categoryAllowlist: ["cell phone"],
    }),
  ]);
  return {
    faceDetector,
    faceLandmarker,
    objectDetector,
    close: () => {
      try { faceDetector.close(); } catch { /* noop */ }
      try { faceLandmarker.close(); } catch { /* noop */ }
      try { objectDetector.close(); } catch { /* noop */ }
    },
  };
}

let faceApiLoaded = false;

/** Loads the tiny face-recognition nets (skips if already loaded). */
export async function loadFaceApiModels(): Promise<void> {
  if (
    faceApiLoaded ||
    (faceapi.nets.tinyFaceDetector.isLoaded &&
      faceapi.nets.faceLandmark68TinyNet.isLoaded &&
      faceapi.nets.faceRecognitionNet.isLoaded)
  ) {
    faceApiLoaded = true;
    return;
  }
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_API_MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL),
  ]);
  faceApiLoaded = true;
}

export type FaceDescriptor = Float32Array;

/** 128-d face descriptor for an image/crop, or null when no face found. */
export async function describeFace(
  input: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): Promise<FaceDescriptor | null> {
  try {
    const det = await faceapi
      .detectSingleFace(
        input,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 }),
      )
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    return det?.descriptor ?? null;
  } catch {
    return null;
  }
}

/** Euclidean distance between two descriptors (face-api verification metric). */
export function faceDistance(a: FaceDescriptor, b: FaceDescriptor): number {
  return faceapi.euclideanDistance(a, b);
}

// ─── Gaze estimation from FaceLandmarker (478-pt FaceMesh) ───────────────────
// Heuristic, not a calibrated gaze tracker: yaw = horizontal nose offset from
// the eye midpoint (normalised by eye width), pitch = vertical nose offset
// from the eye midpoint (normalised by face height).
//
// Thresholds are deliberately loose: on a typical laptop the screen corners
// sit ~15-20° off-axis, and wide-angle cameras shrink the face in frame which
// amplifies normalized offsets (plus lens noise). `faceSizeRatio` (face box
// width ÷ frame width) scales the bars further — a small/distant face gets
// more slack than a close-up one.
export interface GazeEstimate {
  yaw: number;
  pitch: number;
  /** Mild off-centre — nudge with "Look Into the Screen". */
  offCentre: boolean;
  /** Strong turn — "Looking away from the screen". */
  lookingAway: boolean;
}

interface Xy { x: number; y: number }

const avg = (pts: Xy[]): Xy => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

export function estimateGaze(landmarks: Xy[], faceSizeRatio = 0.3): GazeEstimate {
  const at = (i: number): Xy => landmarks[i] ?? { x: 0.5, y: 0.5 };
  const nose = at(1);
  const leftEye = avg([at(33), at(133), at(159), at(145)]);
  const rightEye = avg([at(263), at(362), at(386), at(374)]);
  const eyeMid = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeWidth = Math.max(1e-6, Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y));
  const faceHeight = Math.max(1e-6, Math.hypot(at(152).x - at(10).x, at(152).y - at(10).y));
  const yaw = (nose.x - eyeMid.x) / eyeWidth;
  const pitch = (nose.y - eyeMid.y) / faceHeight;
  // Wide-angle / far cameras → small face in frame → lenient bars.
  const slack = faceSizeRatio < 0.15 ? 1.6 : faceSizeRatio < 0.25 ? 1.3 : 1.0;
  const ax = Math.abs(yaw);
  const ayUp = pitch < 0 ? Math.abs(pitch) : 0;
  const ayDown = pitch > 0 ? pitch : 0;
  const offCentre =
    ax > 0.14 * slack || ayUp > 0.11 * slack || ayDown > 0.14 * slack;
  const lookingAway =
    ax > 0.26 * slack || ayUp > 0.21 * slack || ayDown > 0.26 * slack;
  return { yaw, pitch, offCentre, lookingAway };
}

// ─── Snapshot / embedding helpers ────────────────────────────────────────────

/** Draw the current video frame to a (downscalable) canvas for inference. */
export function frameToCanvas(video: HTMLVideoElement, maxDim = 640): HTMLCanvasElement | null {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function snapshotVideo(video: HTMLVideoElement, maxDim = 640): string | null {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** Crop a normalized face bounding box (with margin) to a fixed canvas. */
export function cropFaceToCanvas(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  box: { originX: number; originY: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
  targetSize = 224,
): HTMLCanvasElement | null {
  if (!sourceWidth || !sourceHeight) return null;
  const margin = 0.25;
  const x = Math.max(0, (box.originX - box.width * margin) * sourceWidth);
  const y = Math.max(0, (box.originY - box.height * margin) * sourceHeight);
  const w = Math.min(sourceWidth - x, box.width * (1 + margin * 2) * sourceWidth);
  const h = Math.min(sourceHeight - y, box.height * (1 + margin * 2) * sourceHeight);
  if (w <= 8 || h <= 8) return null;
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, x, y, w, h, 0, 0, targetSize, targetSize);
  return canvas;
}

/**
 * Minimum score for a "cell phone" detection. Kept below the 0.5 default:
 * phone backs (multi-camera slabs like the S24) score lower than screens,
 * and anything the classifier mislabels is already dropped by the
 * allowlist — so a lower bar here only buys recall, not false positives.
 */
export const PHONE_SCORE_THRESHOLD = 0.35;

/** Proof-frame source per flag: which stream holds the evidence. All six
 *  current AI titles are camera-vision based; screen is reserved for future
 *  screen-share/forbidden-app flags. Capturing only the relevant stream
 *  halves snapshot CPU + upload bytes per flag. */
export const FLAG_PROOF_SOURCE: Record<string, "camera" | "screen"> = {
  "No Face Detected": "camera",
  "Look Into the Screen": "camera",
  "Unauthorized Person Detected": "camera",
  "Looking away from the screen": "camera",
  "Cell Phone Detected": "camera",
  "Multiple face detected": "camera",
};

/** Longest side for the downscaled frame fed to the object detector. */
export const OBJECT_FRAME_MAX_DIM = 640;

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load reference image"));
    img.src = url;
  });
}
