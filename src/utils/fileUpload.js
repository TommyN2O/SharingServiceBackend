const path = require('path');
const fs = require('fs').promises;

const uploadPhotos = async (files) => {
  try {
    const uploadDir = path.join(__dirname, '../../public/images/tasks');

    // Ensure the upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    const photoUrls = [];

    for (const file of files) {
      // Generate unique filename using timestamp and original name
      const timestamp = Date.now();
      const filename = `task_${timestamp}_${file.originalname.replace(/\s+/g, '_')}`;
      const filePath = path.join(uploadDir, filename);

      // Save the file
      await fs.writeFile(filePath, file.buffer);

      // Store the relative path
      photoUrls.push(`images/tasks/${filename}`);
    }

    return photoUrls;
  } catch (error) {
    console.error('Error uploading photos:', error);
    throw new Error('Failed to upload photos');
  }
};

module.exports = {
  uploadPhotos,
};
