"use client";

import { useCallback, useEffect, useRef } from "react";
import { useLiveAPI } from "@/contexts/LiveAPIContext";
import { useMicrophone } from "@/hooks/useMicrophone";

/**
 * Связывает микрофон с Live-сессией: при старте сессии запускается микрофон
 * и чанки отправляются в сессию; при остановке — микрофон останавливается,
 * отправляется audioStreamEnd, сессия отключается.
 * isActiveRef гарантирует, что после stopSession/ошибки чанки из AudioWorklet не идут в закрытый сокет.
 */
export function useLiveSessionWithMicrophone() {
  const api = useLiveAPI();
  const {
    connect,
    disconnect,
    sendAudio,
    sendAudioStreamEnd,
    status,
    error: apiError,
  } = api;

  const isActiveRef = useRef(false);

  const safeSendAudio = useCallback(
    (base64: string) => {
      if (isActiveRef.current) sendAudio(base64);
    },
    [sendAudio]
  );

  const safeSendAudioStreamEnd = useCallback(() => {
    if (isActiveRef.current) sendAudioStreamEnd();
  }, [sendAudioStreamEnd]);

  const microphone = useMicrophone({
    onChunk: safeSendAudio,
    onStreamEnd: safeSendAudioStreamEnd,
  });

  const startSession = useCallback(async () => {
    isActiveRef.current = false;
    // На мобильных (iOS/Safari) getUserMedia должен вызваться в контексте жеста пользователя.
    // Сначала запускаем микрофон, потом подключаем сессию — иначе после await connect() жест «сгорает» и доступ к микрофону блокируется.
    await microphone.start();
    await connect();
    isActiveRef.current = true;
  }, [connect, microphone]);

  const stopSession = useCallback(() => {
    isActiveRef.current = false;
    microphone.stop();
    disconnect();
  }, [microphone, disconnect]);

  useEffect(() => {
    if (status === "idle" || status === "error") {
      isActiveRef.current = false;
      if (microphone.isListening) {
        microphone.stop();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реагируем на status/isListening
  }, [status, microphone.isListening, microphone.stop]);

  const error = apiError ?? microphone.error;

  return {
    startSession,
    stopSession,
    status,
    isListening: microphone.isListening,
    level: microphone.level,
    error,
  };
}
