import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NoteComment } from "./extensions/noteAnnotations";

// =====================================================
// Types
// =====================================================

interface NoteCommentPopoverProps {
  comment: NoteComment;
  anchor: { x: number; y: number };
  onUpdate: (id: number, text: string) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

// =====================================================
// Component
// =====================================================

export function NoteCommentPopover({
  comment,
  anchor,
  onUpdate,
  onDelete,
  onClose,
}: NoteCommentPopoverProps) {
  const [editing, setEditing] = useState(!comment.comment);
  const [text, setText] = useState(comment.comment);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Position directly from anchor prop — no state needed, just derive
  const popWidth = 320;
  const pad = 8;

  let top = anchor.y + 6;
  let left = anchor.x - popWidth / 2;
  if (left < pad) left = pad;
  if (left + popWidth > window.innerWidth - pad) left = window.innerWidth - popWidth - pad;
  // Flip above if it would go off-screen bottom (estimate height)
  if (top + 200 > window.innerHeight - pad) top = anchor.y - 200 - 6;

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [editing]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture to fire before CM6 click handler
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (editing) {
          setEditing(false);
          setText(comment.comment);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [editing, comment.comment, onClose]);

  const handleSave = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed) {
      onUpdate(comment.id, trimmed);
      setEditing(false);
    }
  }, [text, comment.id, onUpdate]);

  const handleDelete = useCallback(() => {
    onDelete(comment.id);
  }, [comment.id, onDelete]);

  const formattedDate = new Date(comment.dateModified || comment.dateAdded).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" },
  );

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 w-80 rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ top, left }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" />
          <span>Comment</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{formattedDate}</span>
      </div>

      {/* Quoted text */}
      {comment.selectedText && (
        <div className="px-3 py-2 border-b bg-muted/30">
          <p className="text-xs text-muted-foreground italic line-clamp-2">
            &ldquo;{comment.selectedText}&rdquo;
          </p>
        </div>
      )}

      {/* Comment body */}
      <div className="px-3 py-2">
        {editing ? (
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              placeholder="Write a comment..."
              className="w-full min-h-[60px] text-sm resize-none rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setEditing(false);
                  setText(comment.comment);
                  if (!comment.comment) onClose();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="default"
                size="icon"
                className="h-7 w-7"
                onClick={handleSave}
                disabled={!text.trim()}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "text-sm cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-accent transition-colors",
              !comment.comment && "text-muted-foreground italic",
            )}
            onClick={() => setEditing(true)}
          >
            {comment.comment || "Click to add a comment..."}
          </div>
        )}
      </div>

      {/* Footer actions */}
      {!editing && (
        <div className="flex items-center justify-end px-3 py-1.5 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
