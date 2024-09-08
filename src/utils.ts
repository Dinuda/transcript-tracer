// Global state variables
let ttIsInitialized = false;
let ttTranscripts: HTMLCollectionOf<Element>;
let ttMediaPlayers: NodeListOf<HTMLAudioElement>;
let ttActivePlayer: HTMLAudioElement | HTMLVideoElement;
let ttLinkedDataByMediaUrl: { [key: string]: any } = {};

// Configuration variables
let ttBlockSelector: string | null = null;
let ttPhraseSelector: string | null = null;
let ttAlignmentFuzziness = 0;
let ttTimeOffset = 0;
let ttAutoScroll: string | null = null;
let ttClickable = false;
let ttTranscriptLoaded = false;

export function cleanupTranscriptTracer(): void {
  if (!ttIsInitialized) return;

  ttMediaPlayers?.forEach((player) => {
    player.removeEventListener("play", handlePlay);
    player.removeEventListener("ended", handleEnded);
    player.removeEventListener("timeupdate", ttTimeUpdate);
  });

  if (ttClickable) {
    document.querySelectorAll(".tt-word").forEach((word) => {
      word.removeEventListener("click", handleWordClick as EventListener);
    });
  }

  // Reset global variables
  ttIsInitialized = false;
  ttTranscripts = null!;
  ttMediaPlayers = null!;
  ttActivePlayer = null!;
  ttLinkedDataByMediaUrl = {};

  // Remove added classes and data attributes
  document.querySelectorAll(".tt-transcript").forEach((transcript) => {
    unlinkTranscript(transcript as HTMLElement);
    (transcript as HTMLElement).dataset.ttTranscript = "";
  });

  document.querySelectorAll(".tt-word, .tt-whitespace").forEach((element) => {
    element.outerHTML = element.innerHTML;
  });

  // Reset configuration variables
  ttBlockSelector = ttPhraseSelector = ttAutoScroll = null;
  ttAlignmentFuzziness = ttTimeOffset = 0;
  ttClickable = false;
}

export function loadTranscriptTracer(
  this: any,
  options: any = null,
  vttText: string
): void {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () =>
      loadTranscriptTracer(options, vttText)
    );
    return;
  }

  if (!vttText) return;

  cleanupTranscriptTracer();

  // Save user-provided options
  if (options) {
    Object.assign(this, options);
  }

  ttIsInitialized = true;
  ttTranscripts = document.getElementsByClassName("tt-transcript");
  ttMediaPlayers = document.querySelectorAll("audio");

  if (!ttMediaPlayers.length) {
    setTimeout(() => {
      ttMediaPlayers = document.querySelectorAll("audio");
      if (!ttMediaPlayers.length) return;
    }, 1000);
  }

  prepareTranscripts();
  setupMediaPlayers(vttText);
  ttTranscriptLoaded = true;
}

function prepareTranscripts() {
  Array.from(ttTranscripts).forEach((transcript, index) => {
    if (!(transcript as HTMLElement).dataset.ttMediaUrls) return;
    (transcript as HTMLElement).dataset.ttTranscript = index.toString();
    addSpansToTextNodes(transcript as HTMLElement);
  });
}

function addSpansToTextNodes(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  textNodes.forEach((textNode) => {
    if (textNode.textContent!.trim()) {
      const fragment = document.createDocumentFragment();
      textNode.textContent!.split(/(\s+)/).forEach((part) => {
        const span = document.createElement("span");
        span.textContent = part;
        span.className = part.trim() ? "tt-word" : "tt-whitespace";
        fragment.appendChild(span);
      });
      textNode.parentNode!.replaceChild(fragment, textNode);
    }
  });
}

function setupMediaPlayers(vttText: string) {
  ttMediaPlayers.forEach((mediaPlayer) => {
    linkTranscripts(mediaPlayer, vttText);
    mediaPlayer.addEventListener("play", handlePlay);
    mediaPlayer.addEventListener("ended", handleEnded);
  });
}

function handlePlay(e: Event) {
  if (!ttTranscriptLoaded) {
    e.preventDefault();
    (e.currentTarget as HTMLAudioElement).pause();
    return;
  }

  if (ttActivePlayer !== e.currentTarget) {
    if (ttActivePlayer) {
      ttActivePlayer.removeEventListener("timeupdate", ttTimeUpdate);
      ttActivePlayer.pause();
    }
    ttActivePlayer = e.currentTarget as HTMLAudioElement | HTMLVideoElement;
    clearHighlightedWords(document.querySelector(".tt-transcript"));
  }

  const linkedMediaUrl = (e.currentTarget as HTMLElement).dataset
    .ttLinkedMediaUrl;
  if (linkedMediaUrl && ttLinkedDataByMediaUrl[linkedMediaUrl]) {
    const currentTranscript = ttTranscripts[
      ttLinkedDataByMediaUrl[linkedMediaUrl].transcriptIndex
    ] as HTMLElement;
    currentTranscript.dataset.ttCurrentMediaUrl = linkedMediaUrl;
  }
  ttActivePlayer.addEventListener("timeupdate", ttTimeUpdate);
}

function handleEnded() {
  clearHighlightedWords(document.querySelector(".tt-transcript"));
}

function ttTimeUpdate(e: Event) {
  if (!ttActivePlayer || e.currentTarget !== ttActivePlayer) return;

  const linkedMediaUrl = ttActivePlayer.dataset.ttLinkedMediaUrl;
  if (!linkedMediaUrl || !ttLinkedDataByMediaUrl[linkedMediaUrl]) return;

  const ttData = ttLinkedDataByMediaUrl[linkedMediaUrl];
  if (ttData.timedEvents.length === 0) return;

  const adjustedCurrentTime = ttActivePlayer.currentTime - ttTimeOffset;
  const currentTranscript = document.querySelector(
    `[data-tt-transcript="${ttData.transcriptIndex}"]`
  );

  clearHighlightedWords(currentTranscript);

  const currentEvent = ttData.timedEvents.find(
    (event: any, index: number) =>
      event.seconds <= adjustedCurrentTime &&
      (!ttData.timedEvents[index + 1] ||
        adjustedCurrentTime < ttData.timedEvents[index + 1].seconds)
  );

  if (currentEvent) {
    highlightCurrentEvent(currentEvent, currentTranscript);
    handleAutoScroll(currentEvent);
  }
}

function highlightCurrentEvent(event: any, transcript: Element | null) {
  if (!transcript) return;

  if (event.blockIndex != null) {
    transcript
      .querySelectorAll(`[data-tt-block="${event.blockIndex}"]`)
      .forEach((el, i) =>
        el.classList.add(
          i === 0 && !el.classList.contains("tt-word")
            ? "tt-current-block-container"
            : "tt-current-block"
        )
      );
  }

  if (event.phraseIndex != null) {
    transcript
      .querySelectorAll(`[data-tt-phrase="${event.phraseIndex}"]`)
      .forEach((el, i) =>
        el.classList.add(
          i === 0 && !el.classList.contains("tt-word")
            ? "tt-current-phrase-container"
            : "tt-current-phrase"
        )
      );
  }

  event.currentWordIndexes.forEach((wordIndex: number) => {
    transcript
      .querySelectorAll(`[data-tt-word="${wordIndex}"]`)
      .forEach((el) => el.classList.add("tt-current-word"));
  });

  let prevWord = true;
  transcript.querySelectorAll(".tt-word").forEach((el) => {
    if (el.classList.contains("tt-current-word")) {
      prevWord = false;
    } else if (prevWord) {
      el.classList.add("tt-previous-word");
    }
  });
}

function handleAutoScroll(currentEvent: any) {
  if (!ttAutoScroll) return;

  const scrollOptions: ScrollIntoViewOptions = {
    behavior: "smooth",
    block: "start",
    inline: "nearest",
  };
  let elementToScroll: Element | null = null;

  if (ttAutoScroll === "block") {
    elementToScroll = document.querySelector(".tt-current-block-container");
  } else if (ttAutoScroll === "phrase") {
    elementToScroll = document.querySelector(".tt-current-phrase-container");
  } else if (ttAutoScroll === "word") {
    elementToScroll = document.querySelector(".tt-current-word");
  }

  elementToScroll?.scrollIntoView(scrollOptions);
}

function clearHighlightedWords(transcript: Element | null) {
  if (!transcript) return;
  transcript
    .querySelectorAll('[class*="tt-current"], [class*="tt-previous"]')
    .forEach((el) => {
      el.classList.remove(
        "tt-current-block",
        "tt-current-block-container",
        "tt-current-phrase",
        "tt-current-phrase-container",
        "tt-current-word",
        "tt-previous-word"
      );
    });
}

function handleWordClick(e: MouseEvent) {
  const wordElement = e.currentTarget as HTMLElement;
  const wordIndex = wordElement.dataset.ttWord;
  const transcript = wordElement.closest(".tt-transcript") as HTMLElement;
  const mediaUrl = transcript.dataset.ttCurrentMediaUrl;
  if (mediaUrl && wordIndex) {
    const startSeconds =
      ttLinkedDataByMediaUrl[mediaUrl].wordTimings[wordIndex].startSeconds;
    ttLinkedDataByMediaUrl[mediaUrl].mediaElement.currentTime = startSeconds;
  }
}

// Link media player to relevant transcripts
function linkTranscripts(mediaPlayer: any, vttText: string) {
  var trackElement = mediaPlayer.querySelector('track[kind="metadata"]');

  var mediaPlayerSourceUrls = [];
  var mediaPlayerSrc = mediaPlayer.getAttribute("src");
  var mediaPlayerSourceElements = mediaPlayer.querySelectorAll("source");
  if (mediaPlayerSrc) mediaPlayerSourceUrls.push(mediaPlayerSrc);
  if (mediaPlayerSourceElements)
    for (const s of mediaPlayerSourceElements)
      mediaPlayerSourceUrls.push(s.src);

  // If there's nothing to link, return
  if (
    !trackElement ||
    !trackElement.getAttribute("src") ||
    mediaPlayerSourceUrls.length == 0
  )
    return;

  // Fetch WebVTT content and link related transcripts
  for (let t = 0; t < ttTranscripts.length; t++) {
    const transcript = ttTranscripts[t] as HTMLElement;
    for (const mediaUrl of mediaPlayerSourceUrls) {
      if (transcript.dataset.ttMediaUrls?.includes(mediaUrl)) {
        mediaPlayer.dataset.ttLinkedMediaUrl = mediaUrl;
        linkTranscript(mediaPlayer, vttText, transcript);
        break;
      }
    }
  }

  function linkTranscript(mediaPlayer: any, vttContent: any, transcript: any) {
    var wordTimings = parseJsonToWordTimings(vttContent);
    if (wordTimings.length === 0) {
      return;
    }
    transcript.dataset.ttCurrentMediaUrl = mediaPlayer.dataset.ttLinkedMediaUrl;

    function normalizedWord(word: string) {
      return word
        .toLowerCase()
        .normalize("NFD") // Decompose accented characters
        .replace(/\p{P}/gu, "") // Remove punctuation
        .replace(/\s+/g, ""); // Remove extra spaces
    }

    // Add metadata to block and phrase containers (if ttBlockSelector and ttPhraseSelector are defined)
    var blockContainers = ttBlockSelector
      ? transcript.querySelectorAll(ttBlockSelector)
      : [];
    for (let c = 0; c < blockContainers.length; c++)
      blockContainers[c].dataset.ttBlock = c;
    var phraseContainers = ttPhraseSelector
      ? transcript.querySelectorAll(ttPhraseSelector)
      : [];
    for (let c = 0; c < phraseContainers.length; c++)
      phraseContainers[c].dataset.ttPhrase = c;

    // Add metadata to each word span, and build timed events list
    var timedEvents = [];
    var wordTimingsIndex = 0;
    var wordSpans = transcript.getElementsByClassName("tt-word");
    for (let s = 0; s < wordSpans.length; s++) {
      var span = wordSpans[s];

      // Find the next word timing object that matches the current span's text
      var initialWordTimingsIndex = wordTimingsIndex;
      var maxFuzzyWordTimingsIndex = Math.min(
        wordTimingsIndex + ttAlignmentFuzziness,
        wordTimings.length - 1
      );
      if (wordTimings[wordTimingsIndex] === undefined) {
        break;
      }

      while (
        normalizedWord(span.innerText) !=
          normalizedWord(wordTimings[wordTimingsIndex].text) &&
        wordTimingsIndex < maxFuzzyWordTimingsIndex
      ) {
        wordTimingsIndex += 1;
      }
      if (
        normalizedWord(span.innerText) !=
        normalizedWord(wordTimings[wordTimingsIndex].text)
      ) {
        // Could not find matching word within the fuzziness range
        wordTimingsIndex = initialWordTimingsIndex;
        continue;
      }

      // Get the block, phrase, and word index
      var blockIndex = ttBlockSelector
        ? span.closest(ttBlockSelector)?.dataset?.ttBlock ?? null
        : wordTimings[wordTimingsIndex].blockIndex;
      var phraseIndex = ttPhraseSelector
        ? span.closest(ttPhraseSelector)?.dataset?.ttPhrase ?? null
        : wordTimings[wordTimingsIndex].phraseIndex;
      var wordIndex = wordTimings[wordTimingsIndex].wordIndex;

      // Add block, phrase, and word index as metadata on the span
      span.dataset.ttBlock = blockIndex;
      span.dataset.ttPhrase = phraseIndex;
      span.dataset.ttWord = wordIndex;

      // Add timed event to timed events list
      if (
        timedEvents.length != 0 &&
        wordTimings[wordTimingsIndex].startSeconds ==
          timedEvents[timedEvents.length - 1].seconds
      ) {
        timedEvents[timedEvents.length - 1].currentWordIndexes.push(wordIndex);
      } else {
        timedEvents.push({
          seconds: wordTimings[wordTimingsIndex].startSeconds,
          currentWordIndexes: [wordIndex],
          phraseIndex: phraseIndex,
          blockIndex: blockIndex,
        });
      }

      wordTimingsIndex += 1;
    }

    // For a given element, find the first parent element containing relevant children
    function findRelevantParent(
      startingElement: any,
      endingElement: any,
      childSelector: any,
      relevantChildSelector: any
    ) {
      var currentElement = startingElement;
      while (currentElement && currentElement != endingElement) {
        var currentElement = currentElement.parentElement;
        var children = currentElement.querySelectorAll(childSelector);
        var relevantChildren = document.querySelectorAll(relevantChildSelector);
        if (children.length == relevantChildren.length) {
          // Relevant parent found
          return currentElement;
        } else if (children.length > relevantChildren.length) {
          // Failed to find a relevant parent
          break;
        }
      }
      return null;
    }

    // Add metadata to block and phrase containers (if ttBlockSelector and ttPhraseSelector aren't defined)
    if (!ttBlockSelector) {
      var count = wordTimings[wordTimings.length - 1].blockIndex + 1;
      for (let c = 0; c < count; c++) {
        var startingElement = document.querySelector(`[data-tt-block="${c}"]`);
        var blockContainer = findRelevantParent(
          startingElement,
          transcript,
          "[data-tt-word]",
          `[data-tt-word][data-tt-block="${c}"]`
        );
        if (blockContainer) blockContainer.dataset.ttBlock = c;
      }
    }
    if (!ttPhraseSelector) {
      var count = wordTimings[wordTimings.length - 1].phraseIndex + 1;
      for (let c = 0; c < count; c++) {
        var startingElement = document.querySelector(`[data-tt-phrase="${c}"]`);
        var phraseContainer = findRelevantParent(
          startingElement,
          transcript,
          "[data-tt-word]",
          `[data-tt-word][data-tt-phrase="${c}"]`
        );
        if (phraseContainer) phraseContainer.dataset.ttPhrase = c;
      }
    }

    // Sort timed events list by time
    timedEvents = timedEvents.sort(function (a, b) {
      return a.seconds - b.seconds;
    });

    // Add reference data to ttLinkedDataByMediaUrl
    var transcriptIndex = parseInt(transcript.dataset.ttTranscript);
    ttLinkedDataByMediaUrl[mediaPlayer.dataset.ttLinkedMediaUrl] = {
      transcriptIndex: transcriptIndex,
      wordTimings: wordTimings,
      timedEvents: timedEvents,
      mediaElement: mediaPlayer,
      textTrackData: mediaPlayer.textTracks[0],
    };

    // Add click listeners to words
    if (ttClickable) {
      for (let i = 0; i < document.querySelectorAll(".tt-word").length; i++) {
        const word = document.querySelectorAll(".tt-word")[i];
        word.addEventListener("click", handleWordClick as EventListener);
      }
    }
  }
}
// Unlink transcript from previous VTT
function unlinkTranscript(transcript: any) {
  clearHighlightedWords(transcript);

  var ttLinkedElements = transcript.querySelectorAll("[data-tt-word]");
  for (const element of ttLinkedElements) {
    element.dataset.ttWord = "";
    element.dataset.ttPhrase = "";
    element.dataset.ttBlock = "";
  }

  var mediaUrl = transcript.dataset.ttCurrentMediaUrl;
  if (mediaUrl) {
    delete ttLinkedDataByMediaUrl[mediaUrl];
    transcript.dataset.ttCurrentMediaUrl = "";
  }

  for (const word of document.querySelectorAll(".tt-word") as any) {
    word.removeEventListener("click", handleWordClick);
  }
}

function parseJsonToWordTimings(script: string) {
  const lines = script.trim().split("\n");
  const wordTimings = [] as any;
  const pattern =
    /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\s*(.*)/;

  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i]);
    if (match) {
      const [_, startTime, endTime] = match;
      let text = "";
      i++;
      while (i < lines.length && !pattern.test(lines[i])) {
        text += lines[i].trim() + " ";
        i++;
      }
      i--; // Step back one line because the outer loop will increment it again
      wordTimings.push({
        text: text.trim().replace(/[,.:;?!]$/, ""), // Remove trailing punctuation
        startSeconds: convertTimeToSeconds(startTime),
        endSeconds: convertTimeToSeconds(endTime),
        wordIndex: wordTimings.length,
        phraseIndex: 0, // Assuming single phrase for simplicity
        blockIndex: 0, // Assuming single block for simplicity
      });
    }
  }
  return wordTimings;
}

function convertTimeToSeconds(time: any) {
  const [hours, minutes, seconds] = time.split(":");
  return (
    parseInt(hours, 10) * 3600 +
    parseInt(minutes, 10) * 60 +
    parseFloat(seconds)
  );
}
