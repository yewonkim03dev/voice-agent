import type { GestureName } from "./GestureWakeConfig.ts";
import type { HandLandmark, HandLandmarkFrame, HandLandmarkName } from "./HandLandmarkProvider.ts";

export interface GestureClassifier {
  classify(frame: HandLandmarkFrame): {
    gesture: GestureName;
    confidence: number;
  };
}

export class LandmarkGestureClassifier implements GestureClassifier {
  classify(frame: HandLandmarkFrame): { gesture: GestureName; confidence: number } {
    const hand = new LandmarkMap(frame.landmarks);
    if (isOpenPalm(hand)) return { gesture: "open_palm", confidence: hand.averageConfidence };
    if (isThumbsDown(hand)) return { gesture: "thumbs_down", confidence: hand.averageConfidence };
    if (isThumbsUp(hand)) return { gesture: "thumbs_up", confidence: hand.averageConfidence };
    if (isPeace(hand)) return { gesture: "peace", confidence: hand.averageConfidence };
    if (isFist(hand)) return { gesture: "fist", confidence: hand.averageConfidence };
    return { gesture: "none", confidence: hand.averageConfidence };
  }
}

class LandmarkMap {
  private readonly points = new Map<HandLandmarkName, HandLandmark>();

  constructor(landmarks: HandLandmark[]) {
    landmarks.forEach((landmark) => this.points.set(landmark.name, landmark));
  }

  get averageConfidence(): number {
    if (this.points.size === 0) return 0;
    let total = 0;
    this.points.forEach((point) => {
      total += point.confidence;
    });
    return total / this.points.size;
  }

  point(name: HandLandmarkName): HandLandmark | undefined {
    const point = this.points.get(name);
    if (!point || point.confidence < 0.25) return undefined;
    return point;
  }
}

function isOpenPalm(hand: LandmarkMap): boolean {
  if (!allExtended(hand, ["index", "middle", "ring", "little"])) return false;
  const indexTip = hand.point("indexTip");
  const littleTip = hand.point("littleTip");
  const wrist = hand.point("wrist");
  const middleMcp = hand.point("middleMCP");
  if (!indexTip || !littleTip || !wrist || !middleMcp) return false;
  return distance(indexTip, littleTip) > distance(wrist, middleMcp) * 0.9;
}

function isThumbsDown(hand: LandmarkMap): boolean {
  const wrist = hand.point("wrist");
  const thumbTip = hand.point("thumbTip");
  const thumbIp = hand.point("thumbIP");
  if (!wrist || !thumbTip || !thumbIp) return false;
  return thumbTip.y < wrist.y - 0.08 && thumbTip.y < thumbIp.y - 0.04 && foldedCount(hand) >= 3;
}

function isThumbsUp(hand: LandmarkMap): boolean {
  const wrist = hand.point("wrist");
  const thumbTip = hand.point("thumbTip");
  const thumbIp = hand.point("thumbIP");
  if (!wrist || !thumbTip || !thumbIp) return false;
  return thumbTip.y > wrist.y + 0.12 && thumbTip.y > thumbIp.y + 0.04 && foldedCount(hand) >= 3;
}

function isPeace(hand: LandmarkMap): boolean {
  const indexTip = hand.point("indexTip");
  const middleTip = hand.point("middleTip");
  if (!indexTip || !middleTip) return false;
  return (
    allExtended(hand, ["index", "middle"]) &&
    isFolded(hand, "ring") &&
    isFolded(hand, "little") &&
    distance(indexTip, middleTip) > 0.06
  );
}

function isFist(hand: LandmarkMap): boolean {
  return foldedCount(hand) >= 4;
}

function foldedCount(hand: LandmarkMap): number {
  return ["index", "middle", "ring", "little"].filter((finger) => isFolded(hand, finger)).length;
}

function allExtended(hand: LandmarkMap, fingers: string[]): boolean {
  return fingers.every((finger) => isExtended(hand, finger));
}

function isExtended(hand: LandmarkMap, finger: string): boolean {
  const tip = hand.point(`${finger}Tip` as HandLandmarkName);
  const pip = hand.point(`${finger}PIP` as HandLandmarkName);
  if (!tip || !pip) return false;
  return tip.y > pip.y + 0.035;
}

function isFolded(hand: LandmarkMap, finger: string): boolean {
  const tip = hand.point(`${finger}Tip` as HandLandmarkName);
  const pip = hand.point(`${finger}PIP` as HandLandmarkName);
  if (!tip || !pip) return false;
  return tip.y < pip.y + 0.025;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

