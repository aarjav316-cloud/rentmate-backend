import { ZodError } from 'zod';

export const validate = (schema) => {
  return async (req, res, next) => {
    try {
      // Validates and parses the request body against the schema
      // This applies formatting (like trim, toLowerCase) and strips unknown fields
      const parsedData = await schema.parseAsync(req.body);

      // Replace req.body with the clean, validated data
      req.body = parsedData;

      // Proceed to the next middleware or controller
      next();
    } catch (error) {
      // Check if it's a Zod validation error
      if (error instanceof ZodError) {
        // Zod v3+ uses .issues (not .errors) for the validation array
        const zodIssues = error.issues || error.errors || [];
        const formattedErrors = zodIssues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: formattedErrors,
        });
      }

      // If it's another type of error, pass it to the global error handler
      next(error);
    }
  };
};

