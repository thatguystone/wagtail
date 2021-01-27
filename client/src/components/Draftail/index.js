import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { DraftailEditor } from 'draftail';
import { EditorState, RichUtils } from 'draft-js';
import DraftOffsetKey from 'draft-js/lib/DraftOffsetKey';

import { IS_IE11, STRINGS } from '../../config/wagtailConfig';

import Icon from '../Icon/Icon';

export { default as Link } from './decorators/Link';
export { default as Document } from './decorators/Document';
export { default as ImageBlock } from './blocks/ImageBlock';
export { default as EmbedBlock } from './blocks/EmbedBlock';

import ModalWorkflowSource from './sources/ModalWorkflowSource';
import Tooltip from './Tooltip/Tooltip';
import TooltipEntity from './decorators/TooltipEntity';
import EditorFallback from './EditorFallback/EditorFallback';

// 1024x1024 SVG path rendering of the "↵" character, that renders badly in MS Edge.
const BR_ICON = 'M.436 633.471l296.897-296.898v241.823h616.586V94.117h109.517v593.796H297.333v242.456z';

/**
 * Registry for client-side code of Draftail plugins.
 */
const PLUGINS = {};

const registerPlugin = (plugin) => {
  PLUGINS[plugin.type] = plugin;
  return PLUGINS;
};

/**
 * Wraps a style/block/entity type’s icon with an icon font implementation,
 * so Draftail can use icon fonts in its toolbar.
 */
export const wrapWagtailIcon = type => {
  const isIconFont = type.icon && typeof type.icon === 'string';
  if (isIconFont) {
    return Object.assign(type, {
      icon: <Icon name={type.icon} />,
    });
  }

  return type;
};

class DraftailInlineAnnotation {
  constructor(initialRef, getEditorState, setEditorState, editor) {
    this.getEditorState = getEditorState;
    this.setEditorState = setEditorState;
    this.editor = editor;
    this.ref = initialRef;
    this.setHidden = null;
    this.setFocused = null;
    this.onClickHandler = null;
  }
  forceResetEditorState(editorState) {
    return EditorState.set(
      EditorState.createWithContent(
        editorState.getCurrentContent(),
        editorState.getDecorator(),
      ),
      {
        selection: editorState.getSelection(),
        undoStack: editorState.getUndoStack(),
        redoStack: editorState.getRedoStack(),
      },
    );
  };
  onDelete() {
  }
  onFocus() {
  }
  onDecoratorAttached(ref) {
    this.ref = ref;
  }
  onUnfocus() {
  }
  show() {
  }
  hide() {
  }
  setOnClickHandler(handler) {
    this.onClickHandler = handler;
  }
  onClick() {
    if (this.onClickHandler) {
      this.onClickHandler()
    }
  }
  getDesiredPosition() {
    const node = this.ref.current;
    if (node) {
      return node.getBoundingClientRect().top + document.documentElement.scrollTop
    }
    return 0
  }
}

class DraftailCommentWidget {
  constructor(
    fieldNode
  ) {
    this.fieldNode = fieldNode;
    this.contentpath = 'test_content_path'; 
    this.commentsEnabled = false;
    this.annotations = new Map();
    this.makeComment = null;
    this.setEditorState = null;
    this.getEditorState = null;
  }
  onRegister(makeComment) {
    this.makeComment = makeComment;
  }
  setEnabled(enabled) {
    // Update whether comments are enabled for the page
    this.commentsEnabled = enabled;
  }
  onChangeComments(comments) {
    // Receives a list of comments for the widget's contentpath
    this.commentNumber = comments.length;
  }
  //getAnnotationForComment(comment) {
  //  return new BasicFieldLevelAnnotation(this.fieldNode, annotationNode);
  //}
  getPlugin() {
    const plugin = {
      initialize: (PluginFunctions) => {
        window.commentApp.registerWidget(this);
        this.setEditorState = PluginFunctions.setEditorState;
        this.getEditorState = PluginFunctions.getEditorState;
      },
      decorators: [
        {
          strategy: this.getDecoratorStrategy(),
          component: this.getDecorator(),
        }
      ]
    }
    return plugin;
  }
  getControl() {

  }
  getSource() {
    const CommentSource = ({ editorState, onComplete }) => {
      useEffect(() => {
        const annotation = new DraftailInlineAnnotation({current: this.fieldNode}, this.getEditorState, this.setEditorState, this.fieldNode.draftailEditor);
        const commentId = this.makeComment(annotation, this.contentpath);
        this.annotations.set(commentId, annotation);
        const nextState = RichUtils.toggleInlineStyle(editorState, `COMMENT-${commentId}`);
        onComplete(nextState);
        }, []
    );
      return null
    };
    return CommentSource;
  }
  getDecorator() {
    const CommentDecorator = ({ contentState, children, offsetKey }) => {
      const blockKey = children[0].props.block.getKey()
      const start = children[0].props.start
      const commentId = useMemo(() => parseInt(contentState.getBlockForKey(blockKey).getInlineStyleAt(start).find((style) => style.startsWith('COMMENT')).slice(8)), [blockKey, start]);
      const annotationNode = useRef(null);
      useEffect(() => {
        this.annotations.get(commentId).onDecoratorAttached(annotationNode);
      });
      const onClick = () => {
        this.annotations.get(commentId).onClick()
      }
    
      return (
        <button type="button" className="button unbutton" style={{'text-transform': 'none', 'background-color': true ? '#01afb0' : '#007d7e'}} ref={annotationNode} onClick={onClick} data-annotation>
          {children}
        </button>
      )
    }
    return CommentDecorator
  }
  getDecoratorStrategy() {
    return (contentBlock, callback, contentState) => {
      contentBlock.findStyleRanges((metadata) => metadata.getStyle().some((style) => style.startsWith('COMMENT')), (start, end) => {callback(start, end)})
    }
  }
}

/**
 * Initialises the DraftailEditor for a given field.
 * @param {string} selector
 * @param {Object} options
 * @param {Element} currentScript
 */
const initEditor = (selector, options, currentScript) => {
  // document.currentScript is not available in IE11. Use a fallback instead.
  const context = currentScript ? currentScript.parentNode : document.body;
  // If the field is not in the current context, look for it in the whole body.
  // Fallback for sequence.js jQuery eval-ed scripts running in document.head.
  const field = context.querySelector(selector) || document.body.querySelector(selector);

  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'Draftail-Editor__wrapper';
  editorWrapper.setAttribute('data-draftail-editor-wrapper', true);

  field.parentNode.appendChild(editorWrapper);

  const serialiseInputValue = rawContentState => {
    field.rawContentState = rawContentState;
    field.value = JSON.stringify(rawContentState);
  };

  const blockTypes = options.blockTypes || [];
  const inlineStyles = options.inlineStyles || [];
  let entityTypes = options.entityTypes || [];

  entityTypes = entityTypes.map(wrapWagtailIcon).map((type) => {
    const plugin = PLUGINS[type.type];

    // Override the properties defined in the JS plugin: Python should be the source of truth.
    return Object.assign({}, plugin, type);
  });

  const enableHorizontalRule = options.enableHorizontalRule ? {
    description: STRINGS.HORIZONTAL_LINE,
  } : false;

  const rawContentState = JSON.parse(field.value);
  field.rawContentState = rawContentState;

  const editorRef = (ref) => {
    // Bind editor instance to its field so it can be accessed imperatively elsewhere.
    field.draftailEditor = ref;
  };

  // TODO: add app check
  console.log(field);
  const comments = new DraftailCommentWidget(field);
  console.log(comments);

  const commentEntity = {
    type: "COMMENT",
    label: "Comment",
    description: "Comment",
    icon: <Icon name="comment"/>,
    source: comments.getSource(),
    decorator: comments.getDecorator(),
  }
  entityTypes.push(commentEntity);

  const editor = (
    <EditorFallback field={field}>
      <DraftailEditor
        ref={editorRef}
        rawContentState={rawContentState}
        onSave={serialiseInputValue}
        placeholder={STRINGS.WRITE_HERE}
        spellCheck={true}
        enableLineBreak={{
          description: STRINGS.LINE_BREAK,
          icon: BR_ICON,
        }}
        showUndoControl={{ description: STRINGS.UNDO }}
        showRedoControl={{ description: STRINGS.REDO }}
        maxListNesting={4}
        // Draft.js + IE 11 presents some issues with pasting rich text. Disable rich paste there.
        stripPastedStyles={IS_IE11}
        {...options}
        plugins={[comments.getPlugin()]}
        blockTypes={blockTypes.map(wrapWagtailIcon)}
        inlineStyles={inlineStyles.map(wrapWagtailIcon)}
        entityTypes={entityTypes}
        enableHorizontalRule={enableHorizontalRule}
      />
    </EditorFallback>
  );

  ReactDOM.render(editor, editorWrapper);
};

export default {
  initEditor,
  registerPlugin,
  // Components exposed for third-party reuse.
  ModalWorkflowSource,
  Tooltip,
  TooltipEntity,
};
