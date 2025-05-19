const config = {
  // Base URL for the API
  baseURL: process.env.API_BASE_URL || 'http://localhost:3000',

  // Authentication endpoints
  auth: {
    register: '/auth/register',
    login: '/auth/login',
    refreshToken: '/auth/refresh-token',
  },

  // User endpoints
  user: {
    profile: '/users/profile',
    updateProfile: '/users/profile',
    dashboard: '/user/dashboard',
    customerRequests: '/user/customer-requests',
    savedTaskers: '/user/saved-taskers',
    messages: '/messages/conversations',
  },

  // Tasker endpoints
  tasker: {
    profile: '/tasker/profile',
    availableTasks: '/tasker/available-tasks',
    offers: '/tasker/offers',
    tasks: '/tasker/tasks',
  },

  // Task endpoints
  task: {
    requests: '/tasks/requests',
    offers: '/tasks/offers',
    plannedTasks: '/tasks/planned-tasks',
    reviews: '/tasks/reviews',
  },

  // Category endpoints
  category: {
    all: '/categories',
    byId: (id) => `/categories/${id}`,
  },

  // Review endpoints
  review: {
    taskerReviews: (taskerId) => `/reviews/tasker/${taskerId}`,
    byId: (id) => `/reviews/${id}`,
  },

  // Message endpoints
  message: {
    conversations: '/messages/conversations',
    conversation: (userId) => `/messages/conversation/${userId}`,
    markAsRead: (senderId) => `/messages/read/${senderId}`,
  },
};

module.exports = config;
