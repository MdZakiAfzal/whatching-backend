import BotFlow, { IBotFlow, IBotFlowAction } from '../models/BotFlow';

export const normalizeTriggerKey = (value: string) => value.trim().toUpperCase();

export const getPublishedFlowByTriggerKey = async (orgId: string, triggerKey: string) =>
  BotFlow.findOne({
    orgId,
    triggerKey: normalizeTriggerKey(triggerKey),
    status: 'published',
  });

export const getBotDefaultFlow = async (orgId: string, defaultTriggerKey: string) =>
  getPublishedFlowByTriggerKey(orgId, defaultTriggerKey);

export const resolveInteractiveAction = (
  flow: IBotFlow | null,
  replyId?: string | null
): IBotFlowAction | null => {
  if (!flow || !replyId) {
    return null;
  }

  return flow.actions.find((action) => action.replyId === replyId) || null;
};

export const findPublishedFlowByReplyId = async (orgId: string, replyId: string) =>
  BotFlow.findOne({
    orgId,
    status: 'published',
    actions: {
      $elemMatch: {
        replyId,
      },
    },
  });

type ButtonContent = {
  bodyText: string;
  headerText?: string;
  footerText?: string;
  mediaType?: 'image' | 'document' | 'video';
  mediaUrl?: string;
  filename?: string;
};

type ListContent = {
  bodyText: string;
  buttonText: string;
  headerText?: string;
  footerText?: string;
  sections: Array<{
    title: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
};

type MediaContent = {
  caption?: string;
  mediaUrl: string;
  filename?: string;
};

type LocationContent = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

type ProductContent = {
  headerText?: string;
  bodyText: string;
  footerText?: string;
  catalogId: string;
  sections: Array<{
    title: string;
    productRetailerIds: string[];
  }>;
};

type GenericCarouselContent = {
  bodyText?: string;
  cards: Array<{
    mediaType?: 'image' | 'video';
    mediaUrl?: string;
    bodyText: string;
    buttons: Array<{
      type?: 'quick_reply' | 'url';
      replyId?: string;
      label: string;
      url?: string;
    }>;
  }>;
};

const addInteractiveTextParts = (
  interactive: Record<string, unknown>,
  content: { headerText?: string; bodyText?: string; footerText?: string }
) => {
  if (content.headerText) {
    if (interactive.header) {
      return;
    }
    interactive.header = {
      type: 'text',
      text: content.headerText,
    };
  }

  if (content.bodyText) {
    interactive.body = {
      text: content.bodyText,
    };
  }

  if (content.footerText) {
    interactive.footer = {
      text: content.footerText,
    };
  }
};

export const buildMetaPayloadFromFlow = (flow: IBotFlow, to: string) => {
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
  };

  switch (flow.blockType) {
    case 'text': {
      const content = flow.content as { text: string };
      payload.type = 'text';
      payload.text = {
        preview_url: false,
        body: String(content.text || '').trim(),
      };
      return payload;
    }

    case 'buttons': {
      const content = flow.content as ButtonContent;
      payload.type = 'interactive';
      const interactive: Record<string, unknown> = {
        type: 'button',
        action: {
          buttons: flow.actions
            .filter((action) => Boolean(action.replyId && action.label))
            .map((action) => ({
              type: 'reply',
              reply: {
                id: action.replyId,
                title: action.label,
              },
            })),
        },
      };
      if (content.mediaType && content.mediaUrl) {
        interactive.header = {
          type: content.mediaType,
          [content.mediaType]: {
            link: content.mediaUrl,
            ...(content.mediaType === 'document' && content.filename
              ? { filename: content.filename }
              : {}),
          },
        };
      }
      addInteractiveTextParts(interactive, content);
      payload.interactive = interactive;
      return payload;
    }

    case 'list': {
      const content = flow.content as ListContent;
      payload.type = 'interactive';
      const interactive: Record<string, unknown> = {
        type: 'list',
        action: {
          button: content.buttonText,
          sections: content.sections.map((section) => ({
            title: section.title,
            rows: section.rows.map((row) => ({
              id: row.id,
              title: row.title,
              ...(row.description ? { description: row.description } : {}),
            })),
          })),
        },
      };
      addInteractiveTextParts(interactive, content);
      payload.interactive = interactive;
      return payload;
    }

    case 'image': {
      const content = flow.content as MediaContent;
      payload.type = 'image';
      payload.image = {
        link: content.mediaUrl,
        ...(content.caption ? { caption: content.caption } : {}),
      };
      return payload;
    }

    case 'document': {
      const content = flow.content as MediaContent;
      payload.type = 'document';
      payload.document = {
        link: content.mediaUrl,
        ...(content.caption ? { caption: content.caption } : {}),
        ...(content.filename ? { filename: content.filename } : {}),
      };
      return payload;
    }

    case 'location': {
      const content = flow.content as LocationContent;
      payload.type = 'location';
      payload.location = {
        latitude: content.latitude,
        longitude: content.longitude,
        ...(content.name ? { name: content.name } : {}),
        ...(content.address ? { address: content.address } : {}),
      };
      return payload;
    }

    case 'product_carousel': {
      const content = flow.content as ProductContent;
      payload.type = 'interactive';
      const interactive: Record<string, unknown> = {
        type: 'product_list',
        action: {
          catalog_id: content.catalogId,
          sections: content.sections.map((section) => ({
            title: section.title,
            product_items: section.productRetailerIds.map((productRetailerId) => ({
              product_retailer_id: productRetailerId,
            })),
          })),
        },
      };
      addInteractiveTextParts(interactive, content);
      payload.interactive = interactive;
      return payload;
    }

    case 'generic_carousel': {
      const content = flow.content as GenericCarouselContent;
      payload.type = 'interactive';
      payload.interactive = {
        type: 'carousel',
        body: {
          text: content.bodyText || flow.name,
        },
        action: {
          cards: (content.cards || []).map((card, cardIndex) => ({
            card_index: cardIndex,
            type: (card.buttons || [])[0]?.type === 'url' || (card.buttons || [])[0]?.url
              ? 'cta_url'
              : 'button',
            ...(card.mediaType && card.mediaUrl
              ? {
                  header: {
                    type: card.mediaType,
                    [card.mediaType]: {
                      link: card.mediaUrl,
                    },
                  },
                }
              : {}),
            body: {
              text: card.bodyText,
            },
            action: {
              ...((card.buttons || [])[0]?.type === 'url' || (card.buttons || [])[0]?.url
                ? (() => {
                    const urlButton = (card.buttons || [])[0];
                    return {
                      name: 'cta_url',
                      parameters: {
                        display_text: urlButton?.label,
                        url: urlButton?.url,
                      },
                    };
                  })()
                : {
                    buttons: (card.buttons || []).map((button) => ({
                      type: 'quick_reply',
                      quick_reply: {
                        id: button.replyId,
                        title: button.label,
                      },
                    })),
                  }),
            },
          })),
        },
      };
      return payload;
    }

    default:
      throw new Error(`Unsupported bot flow block type: ${flow.blockType}`);
  }
};
