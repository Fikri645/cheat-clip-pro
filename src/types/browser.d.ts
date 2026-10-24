/// <reference types="youtube" />

interface NativeDetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface Window {
  YT: typeof YT;
  onYouTubeIframeAPIReady: (() => void) | undefined;
  webkitAudioContext?: typeof AudioContext;
  opera?: string;
  FaceDetector?: new (options: {fastMode: boolean; maxDetectedFaces: number}) => {
    detect(source: CanvasImageSource): Promise<NativeDetectedFace[]>;
  };
}

interface Navigator {
  userLanguage?: string;
}

declare namespace YT {
  interface Player { unloadModule?(name:string):void }
}
