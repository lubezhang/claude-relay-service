function toUnifiedImageBlock(block) {
  if (!block) {
    return null
  }

  if (block.type === 'image' && block.source) {
    return {
      type: 'image',
      sourceType: block.source.type || 'base64',
      mediaType: block.source.media_type || null,
      data: block.source.data || null,
      url: block.source.url || null
    }
  }

  if (block.type === 'input_image') {
    return {
      type: 'image',
      sourceType: block.image_url ? 'url' : 'base64',
      mediaType: block.mime_type || null,
      data: block.image_base64 || null,
      url: block.image_url || null
    }
  }

  if (block.type === 'image_url') {
    return {
      type: 'image',
      sourceType: 'url',
      mediaType: null,
      data: null,
      url: block.image_url?.url || null
    }
  }

  return null
}

function toChatImagePart(block) {
  const url = block.url || `data:${block.mediaType};base64,${block.data}`
  return {
    type: 'image_url',
    image_url: { url }
  }
}

module.exports = {
  toChatImagePart,
  toUnifiedImageBlock
}
