function mapModelName(model, modelMapping = null) {
  if (!model || !modelMapping) {
    return model
  }

  if (modelMapping[model]) {
    return modelMapping[model]
  }

  const lowerModel = model.toLowerCase()
  for (const [key, value] of Object.entries(modelMapping)) {
    if (key.toLowerCase() === lowerModel) {
      return value
    }
  }

  return model
}

module.exports = {
  mapModelName
}
