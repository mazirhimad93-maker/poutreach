import React, { useEffect, useRef } from 'react';
import {
  Bold,
  Image as ImageIcon,
  Italic,
  Link2,
  Paperclip,
  Underline,
  X,
} from 'lucide-react';

type RichEmailComposerProps = {
  theme: string;
  html: string;
  onHtmlChange: (html: string) => void;
  attachments: File[];
  onAttachmentsChange: (files: File[]) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
};

const FONT_SIZES: Record<string, string> = {
  Small: '2',
  Normal: '3',
  Large: '4',
  Huge: '5',
};

export function RichEmailComposer({
  theme,
  html,
  onHtmlChange,
  attachments,
  onAttachmentsChange,
  disabled = false,
  onError,
}: RichEmailComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const gold = theme === 'gold';

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (editor.innerHTML !== html) editor.innerHTML = html;
  }, [html]);

  const sync = () => {
    onHtmlChange(editorRef.current?.innerHTML || '');
  };

  const command = (name: string, value?: string) => {
    if (disabled) return;
    const editor = editorRef.current;
    editor?.focus();
    document.execCommand(name, false, value);
    sync();
  };

  const insertLink = () => {
    if (disabled) return;
    const value = window.prompt('Paste the link URL');
    if (!value) return;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    command('createLink', url);
  };

  const addAttachments = (files: File[]) => {
    const next = [...attachments, ...files].slice(0, 5);
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (total > 3000000) {
      onError?.('Attachments must be 3 MB total or less.');
      return;
    }
    onAttachmentsChange(next);
  };

  const insertInlineImage = (file?: File) => {
    if (!file || disabled) return;
    if (!file.type.startsWith('image/')) {
      onError?.('Choose an image file.');
      return;
    }
    if (file.size > 1000000) {
      onError?.('Inline images must be 1 MB or smaller.');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => onError?.('Could not read that image.');
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const editor = editorRef.current;
      editor?.focus();
      document.execCommand('insertImage', false, dataUrl);
      sync();
    };
    reader.readAsDataURL(file);
  };

  const toolbarButton = `inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm transition-colors disabled:opacity-40 ${
    gold
      ? 'border-yellow-400/20 text-gray-300 hover:bg-white/5'
      : 'border-gray-200 text-gray-700 hover:bg-gray-100'
  }`;

  const selectClass = `h-8 rounded-md border px-2 text-xs ${
    gold
      ? 'border-yellow-400/20 bg-black/30 text-gray-200'
      : 'border-gray-200 bg-white text-gray-700'
  }`;

  return (
    <div
      className={`overflow-hidden rounded-xl border ${
        gold ? 'border-yellow-400/20 bg-black/20' : 'border-gray-200 bg-white'
      }`}
    >
      <div
        className={`flex flex-wrap items-center gap-1 border-b px-2 py-2 ${
          gold ? 'border-yellow-400/20' : 'border-gray-200'
        }`}
      >
        <select
          aria-label="Font"
          className={selectClass}
          disabled={disabled}
          defaultValue="Arial"
          onChange={event => command('fontName', event.target.value)}
        >
          <option value="Arial">Arial</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Georgia">Georgia</option>
          <option value="Tahoma">Tahoma</option>
          <option value="Trebuchet MS">Trebuchet</option>
          <option value="Verdana">Verdana</option>
          <option value="Courier New">Courier</option>
        </select>

        <select
          aria-label="Font size"
          className={selectClass}
          disabled={disabled}
          defaultValue="Normal"
          onChange={event => command('fontSize', FONT_SIZES[event.target.value] || '3')}
        >
          {Object.keys(FONT_SIZES).map(label => (
            <option key={label} value={label}>{label}</option>
          ))}
        </select>

        <span className={`mx-1 h-5 w-px ${gold ? 'bg-yellow-400/20' : 'bg-gray-200'}`} />

        <button type="button" className={toolbarButton} disabled={disabled} onClick={() => command('bold')} title="Bold">
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" className={toolbarButton} disabled={disabled} onClick={() => command('italic')} title="Italic">
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" className={toolbarButton} disabled={disabled} onClick={() => command('underline')} title="Underline">
          <Underline className="h-4 w-4" />
        </button>
        <button type="button" className={toolbarButton} disabled={disabled} onClick={insertLink} title="Insert link">
          <Link2 className="h-4 w-4" />
        </button>

        <span className={`mx-1 h-5 w-px ${gold ? 'bg-yellow-400/20' : 'bg-gray-200'}`} />

        <button
          type="button"
          className={toolbarButton}
          disabled={disabled}
          onClick={() => imageInputRef.current?.click()}
          title="Insert image"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={event => {
            insertInlineImage(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />

        <button
          type="button"
          className={toolbarButton}
          disabled={disabled}
          onClick={() => attachmentInputRef.current?.click()}
          title="Attach files"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={event => {
            addAttachments(Array.from(event.target.files || []));
            event.currentTarget.value = '';
          }}
        />

        <button
          type="button"
          className={toolbarButton}
          disabled={disabled}
          onClick={() => command('insertUnorderedList')}
          title="Bulleted list"
        >
          •
        </button>
        <button
          type="button"
          className={toolbarButton}
          disabled={disabled}
          onClick={() => command('insertOrderedList')}
          title="Numbered list"
        >
          1.
        </button>
      </div>

      <div
        ref={editorRef}
        role="textbox"
        aria-label="Your reply"
        aria-multiline="true"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder="Write your reply…"
        onInput={sync}
        className={`min-h-44 max-h-96 overflow-y-auto px-4 py-3 text-sm leading-6 outline-none [&:empty:before]:pointer-events-none [&:empty:before]:text-gray-400 [&:empty:before]:content-[attr(data-placeholder)] ${
          gold ? 'text-gray-100' : 'text-gray-900'
        }`}
      />

      {attachments.length > 0 && (
        <div className={`flex flex-wrap gap-2 border-t px-3 py-2 ${gold ? 'border-yellow-400/20' : 'border-gray-200'}`}>
          {attachments.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs ${
                gold ? 'bg-white/10 text-gray-200' : 'bg-gray-100 text-gray-700'
              }`}
            >
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="max-w-48 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onAttachmentsChange(attachments.filter((_, i) => i !== index))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
