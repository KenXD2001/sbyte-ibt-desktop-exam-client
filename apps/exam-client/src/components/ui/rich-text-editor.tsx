import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
}

/**
 * Candidate answer editor — same Tiptap base as the admin portal's exam
 * instructions editor (StarterKit + Placeholder), without the
 * image-upload flow (answers are text + formatting only).
 * NOTE: StarterKit v3 bundles Underline — do NOT add
 * @tiptap/extension-underline explicitly (duplicate-name warning + conflicts).
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write your answer here...',
  disabled = false,
  minHeight = '180px',
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const normalized = value || '';
    if (editor.getHTML() !== normalized) {
      editor.commands.setContent(normalized || '<p></p>', { emitUpdate: false });
    }
  }, [editor, value]);

  const ToolbarButton = ({ onClick, active, children, label }: {
    onClick: () => void;
    active?: boolean;
    children: React.ReactNode;
    label: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-background">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input bg-muted/30 px-2 py-1.5">
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBold().run()}
          active={editor?.isActive('bold')}
          label="Bold"
        >
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          active={editor?.isActive('italic')}
          label="Italic"
        >
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          active={editor?.isActive('underline')}
          label="Underline"
        >
          <UnderlineIcon size={16} />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          active={editor?.isActive('bulletList')}
          label="Bullet List"
        >
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          active={editor?.isActive('orderedList')}
          label="Ordered List"
        >
          <ListOrdered size={16} />
        </ToolbarButton>
      </div>
      <EditorContent
        editor={editor}
        className={cn(
          'px-3 py-2 [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:my-1 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror]:text-sm [&_.ProseMirror]:leading-relaxed',
          disabled && 'cursor-not-allowed opacity-60',
        )}
        style={{ minHeight }}
      />
    </div>
  );
}
