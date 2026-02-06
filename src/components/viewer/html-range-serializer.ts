/**
 * XPath-based Range serialization/deserialization for HTML annotations.
 * Provides stable position storage that survives page reloads.
 */

export interface HTMLTextPosition {
  type: "text";
  startContainerXPath: string;
  startOffset: number;
  endContainerXPath: string;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
  pageNumber: number; // Always 1 for HTML
  sectionHeading?: string;
}

export interface HTMLSpatialPosition {
  type: "spatial";
  anchorXPath: string;
  anchorOffsetX: number;
  anchorOffsetY: number;
  width: number;
  height: number;
  pageNumber: number; // Always 1 for HTML
  sectionHeading?: string;
}

export type HTMLPosition = HTMLTextPosition | HTMLSpatialPosition;

/**
 * Build an XPath string from a DOM node to the document root.
 */
export function getXPath(node: Node, rootDoc: Document): string {
  const parts: string[] = [];
  let current: Node | null = node;

  while (current && current !== rootDoc) {
    if (current.nodeType === Node.TEXT_NODE) {
      // Count text node index among siblings
      const parent: Node | null = current.parentNode;
      if (parent) {
        let textIndex = 0;
        for (let i = 0; i < parent.childNodes.length; i++) {
          if (parent.childNodes[i] === current) break;
          if (parent.childNodes[i].nodeType === Node.TEXT_NODE) textIndex++;
        }
        parts.unshift(`text()[${textIndex + 1}]`);
      }
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      const tagName = element.tagName.toLowerCase();
      const parent = element.parentNode;

      if (parent) {
        let sameTagIndex = 0;
        let sameTagCount = 0;
        for (let i = 0; i < parent.childNodes.length; i++) {
          const sibling = parent.childNodes[i];
          if (
            sibling.nodeType === Node.ELEMENT_NODE &&
            (sibling as Element).tagName.toLowerCase() === tagName
          ) {
            if (sibling === current) sameTagIndex = sameTagCount;
            sameTagCount++;
          }
        }
        if (sameTagCount > 1) {
          parts.unshift(`${tagName}[${sameTagIndex + 1}]`);
        } else {
          parts.unshift(tagName);
        }
      }
    }

    current = current.parentNode;
  }

  return "/" + parts.join("/");
}

/**
 * Resolve an XPath string back to a DOM node.
 */
export function resolveXPath(xpath: string, rootDoc: Document): Node | null {
  try {
    const result = rootDoc.evaluate(
      xpath,
      rootDoc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch {
    return null;
  }
}

/**
 * Serialize a Selection Range to an HTMLTextPosition.
 */
export function serializeRange(
  range: Range,
  iframeDoc: Document
): HTMLTextPosition | null {
  const selectedText = range.toString();
  if (!selectedText.trim()) return null;

  const startXPath = getXPath(range.startContainer, iframeDoc);
  const endXPath = getXPath(range.endContainer, iframeDoc);

  // Extract surrounding context for fuzzy re-anchoring
  const textContent = iframeDoc.body.textContent || "";
  const fullText = selectedText;
  const textIndex = textContent.indexOf(fullText);

  const prefix =
    textIndex > 0
      ? textContent.slice(Math.max(0, textIndex - 30), textIndex)
      : "";
  const suffix =
    textIndex >= 0
      ? textContent.slice(
          textIndex + fullText.length,
          textIndex + fullText.length + 30
        )
      : "";

  const heading = findNearestHeading(range.startContainer, iframeDoc);

  return {
    type: "text",
    startContainerXPath: startXPath,
    startOffset: range.startOffset,
    endContainerXPath: endXPath,
    endOffset: range.endOffset,
    selectedText,
    prefix,
    suffix,
    pageNumber: 1,
    sectionHeading: heading || undefined,
  };
}

/**
 * Reconstruct a Range from an HTMLTextPosition.
 * Falls back to fuzzy text search if XPath fails.
 */
export function deserializeRange(
  position: HTMLTextPosition,
  iframeDoc: Document
): Range | null {
  // Try XPath-based reconstruction first
  const startNode = resolveXPath(position.startContainerXPath, iframeDoc);
  const endNode = resolveXPath(position.endContainerXPath, iframeDoc);

  if (startNode && endNode) {
    try {
      const range = iframeDoc.createRange();
      range.setStart(startNode, position.startOffset);
      range.setEnd(endNode, position.endOffset);

      // Verify the text matches
      if (range.toString() === position.selectedText) {
        return range;
      }
    } catch {
      // XPath nodes exist but offsets are wrong — fall through to fuzzy
    }
  }

  // Fuzzy fallback: search for the text with context
  return fuzzyFindRange(position, iframeDoc);
}

/**
 * Fuzzy search for text in the document using prefix/suffix context.
 */
function fuzzyFindRange(
  position: HTMLTextPosition,
  iframeDoc: Document
): Range | null {
  const searchText = position.selectedText;
  const walker = iframeDoc.createTreeWalker(
    iframeDoc.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  // Build concatenated text with node tracking
  const nodes: { node: Text; start: number; end: number }[] = [];
  let totalLength = 0;
  let textNode: Text | null;

  while ((textNode = walker.nextNode() as Text | null)) {
    const text = textNode.textContent || "";
    nodes.push({
      node: textNode,
      start: totalLength,
      end: totalLength + text.length,
    });
    totalLength += text.length;
  }

  const fullText = nodes.map((n) => n.node.textContent || "").join("");

  // Search for the text with context
  const contextSearch = position.prefix + searchText + position.suffix;
  let idx = fullText.indexOf(contextSearch);
  let matchStart: number;

  if (idx >= 0) {
    matchStart = idx + position.prefix.length;
  } else {
    // Try without context
    idx = fullText.indexOf(searchText);
    if (idx < 0) return null;
    matchStart = idx;
  }

  const matchEnd = matchStart + searchText.length;

  // Find the nodes that contain the start and end
  let startNodeInfo: (typeof nodes)[0] | null = null;
  let endNodeInfo: (typeof nodes)[0] | null = null;

  for (const info of nodes) {
    if (!startNodeInfo && info.end > matchStart) {
      startNodeInfo = info;
    }
    if (info.end >= matchEnd) {
      endNodeInfo = info;
      break;
    }
  }

  if (!startNodeInfo || !endNodeInfo) return null;

  try {
    const range = iframeDoc.createRange();
    range.setStart(startNodeInfo.node, matchStart - startNodeInfo.start);
    range.setEnd(endNodeInfo.node, matchEnd - endNodeInfo.start);
    return range;
  } catch {
    return null;
  }
}

/**
 * Serialize a spatial position (for area/freetext/shape/drawing annotations).
 */
export function serializeSpatialPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  iframeDoc: Document
): HTMLSpatialPosition {
  const { scrollLeft, scrollTop } = getScrollOffsets(iframeDoc);
  const { scaleX, scaleY } = getDocumentScale(iframeDoc);

  const viewportX = (x - scrollLeft) * scaleX;
  const viewportY = (y - scrollTop) * scaleY;

  const anchor = findNearestBlockElement(viewportX, viewportY, iframeDoc);
  const heading = anchor
    ? findNearestHeading(anchor, iframeDoc)
    : null;

  return {
    type: "spatial",
    anchorXPath: "/html/body",
    anchorOffsetX: x,
    anchorOffsetY: y,
    width,
    height,
    pageNumber: 1,
    sectionHeading: heading || undefined,
  };
}

/**
 * Deserialize a spatial position back to absolute coordinates.
 */
export function deserializeSpatialPosition(
  position: HTMLSpatialPosition,
  iframeDoc: Document
): { x: number; y: number; width: number; height: number } | null {
  const { scrollLeft, scrollTop } = getScrollOffsets(iframeDoc);
  const { scaleX, scaleY } = getDocumentScale(iframeDoc);

  const anchor = resolveXPath(position.anchorXPath, iframeDoc);
  if (!anchor || !(anchor instanceof Element || anchor instanceof HTMLElement)) {
    // Fallback to raw offsets from body
    return {
      x: position.anchorOffsetX,
      y: position.anchorOffsetY,
      width: position.width,
      height: position.height,
    };
  }

  if (anchor === iframeDoc.body) {
    return {
      x: position.anchorOffsetX,
      y: position.anchorOffsetY,
      width: position.width,
      height: position.height,
    };
  }

  const rect = (anchor as Element).getBoundingClientRect();
  return {
    x: rect.left / scaleX + scrollLeft + position.anchorOffsetX,
    y: rect.top / scaleY + scrollTop + position.anchorOffsetY,
    width: position.width,
    height: position.height,
  };
}

/**
 * Walk up/backward to find the nearest heading (h1-h6).
 */
export function findNearestHeading(
  node: Node,
  iframeDoc: Document
): string | null {
  const headingTags = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

  // Walk backward through DOM to find nearest heading
  let current: Node | null = node;

  while (current && current !== iframeDoc.body) {
    // Check if current element is a heading
    if (
      current.nodeType === Node.ELEMENT_NODE &&
      headingTags.has((current as Element).tagName)
    ) {
      return (current as Element).textContent?.trim() || null;
    }

    // Check previous siblings
    let sibling = current.previousSibling;
    while (sibling) {
      if (
        sibling.nodeType === Node.ELEMENT_NODE &&
        headingTags.has((sibling as Element).tagName)
      ) {
        return (sibling as Element).textContent?.trim() || null;
      }
      // Check inside the sibling for headings (search backward)
      if (sibling.nodeType === Node.ELEMENT_NODE) {
        const headings = (sibling as Element).querySelectorAll(
          "h1, h2, h3, h4, h5, h6"
        );
        if (headings.length > 0) {
          return headings[headings.length - 1].textContent?.trim() || null;
        }
      }
      sibling = sibling.previousSibling;
    }

    current = current.parentNode;
  }

  return null;
}

/**
 * Find the closest block-level element at given coordinates.
 */
export function findNearestBlockElement(
  viewportX: number,
  viewportY: number,
  iframeDoc: Document
): Element | null {
  const blockElements = new Set([
    "DIV",
    "P",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "ASIDE",
    "HEADER",
    "FOOTER",
    "NAV",
    "LI",
    "BLOCKQUOTE",
    "PRE",
    "TABLE",
    "FIGURE",
    "DETAILS",
  ]);

  let element = iframeDoc.elementFromPoint(viewportX, viewportY);

  while (element && element !== iframeDoc.body) {
    if (blockElements.has(element.tagName)) {
      return element;
    }
    element = element.parentElement;
  }

  return iframeDoc.body;
}

function getScrollOffsets(iframeDoc: Document): { scrollLeft: number; scrollTop: number } {
  const scrollEl = iframeDoc.scrollingElement || iframeDoc.documentElement;
  return {
    scrollLeft: scrollEl?.scrollLeft || 0,
    scrollTop: scrollEl?.scrollTop || 0,
  };
}

function getDocumentScale(iframeDoc: Document): { scaleX: number; scaleY: number } {
  const view = iframeDoc.defaultView;
  const body = iframeDoc.body;
  if (!view || !body) {
    return { scaleX: 1, scaleY: 1 };
  }

  const transform = view.getComputedStyle(body).transform;
  if (!transform || transform === "none") {
    return { scaleX: 1, scaleY: 1 };
  }

  const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);
  if (matrixMatch) {
    const parts = matrixMatch[1].split(",").map((v) => parseFloat(v.trim()));
    const scaleX = parts[0] || 1;
    const scaleY = parts[3] || 1;
    return { scaleX, scaleY };
  }

  const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/);
  if (matrix3dMatch) {
    const parts = matrix3dMatch[1].split(",").map((v) => parseFloat(v.trim()));
    const scaleX = parts[0] || 1;
    const scaleY = parts[5] || 1;
    return { scaleX, scaleY };
  }

  return { scaleX: 1, scaleY: 1 };
}
